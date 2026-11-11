#!/usr/bin/env bash
# For this dedicated Ubuntu proxy host. Run over verified public-key SSH.
# Preserves Reality 8443; removes the unused plaintext HTTPUpgrade 443 inlet.
# A ten-minute rollback remains armed until an independent client verifies access.
set -Eeuo pipefail
export LC_ALL=C
[[ $EUID == 0 && -n ${SSH_CONNECTION:-} ]] || { echo 'Run through verified SSH as root'; exit 1; }
command -v iptables-restore >/dev/null
command -v ip6tables-restore >/dev/null
systemctl is-active --quiet xray
/usr/sbin/sshd -t
BACKUP="/root/vps-hardening-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 700 "$BACKUP"
for path in /etc/ssh/sshd_config /etc/ssh/sshd_config.d /root/.ssh/authorized_keys /etc/iptables /etc/systemd/system/smtp-block.service /etc/systemd/system/xray.service.d /usr/local/etc/xray/config.json; do
  [[ ! -e $path ]] || cp -a --parents "$path" "$BACKUP/"
done
iptables-save > "$BACKUP/rules.before.v4"
ip6tables-save > "$BACKUP/rules.before.v6"
systemctl is-enabled smtp-block.service > "$BACKUP/smtp-enabled" || true
cat > "$BACKUP/rollback.sh" <<'ROLLBACK'
#!/usr/bin/env bash
set -eu
BACKUP=$(cd -- "$(dirname -- "$0")" && pwd)
rm -f /etc/ssh/sshd_config.d/00-vps-hardening.conf
rm -f /etc/systemd/system/xray.service.d/90-vps-hardening.conf
cp -a "$BACKUP/etc/ssh/sshd_config.d/." /etc/ssh/sshd_config.d/
cp -a "$BACKUP/etc/systemd/system/xray.service.d/." /etc/systemd/system/xray.service.d/
cp -a "$BACKUP/usr/local/etc/xray/config.json" /usr/local/etc/xray/config.json
cp -a "$BACKUP/etc/iptables/." /etc/iptables/
iptables-restore < "$BACKUP/rules.before.v4"
ip6tables-restore < "$BACKUP/rules.before.v6"
if grep -qx enabled "$BACKUP/smtp-enabled"; then systemctl enable smtp-block.service; fi
systemctl daemon-reload
/usr/sbin/sshd -t && systemctl reload ssh
systemctl restart xray
logger -t vps-hardening 'Hardening network/SSH/Xray changes rolled back'
ROLLBACK
chmod 700 "$BACKUP/rollback.sh"
systemd-run --unit=vps-hardening-rollback --on-active=10m /bin/bash "$BACKUP/rollback.sh"
trap 'rc=$?; trap - ERR; bash "$BACKUP/rollback.sh"; exit "$rc"' ERR

install -d -m 755 /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/00-vps-hardening.conf <<'SSH'
# SSH stays on 22; the already-verified root public keys remain usable.
PermitRootLogin prohibit-password
PubkeyAuthentication yes
AuthenticationMethods publickey
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitEmptyPasswords no
AuthorizedKeysFile .ssh/authorized_keys
MaxAuthTries 3
LoginGraceTime 30
MaxStartups 10:30:30
DisableForwarding yes
X11Forwarding no
PermitUserEnvironment no
LogLevel VERBOSE
SSH
chmod 644 /etc/ssh/sshd_config.d/00-vps-hardening.conf
/usr/sbin/sshd -t
systemctl reload ssh

python3 - <<'PY'
import json, os
path='/usr/local/etc/xray/config.json'
with open(path) as f: config=json.load(f)
inbounds=config['inbounds']
assert any(i.get('port')==8443 and i.get('streamSettings',{}).get('security')=='reality' for i in inbounds)
assert all(i.get('port')==8443 or (i.get('port')==443 and i.get('streamSettings',{}).get('network')=='httpupgrade') for i in inbounds), 'Unexpected inlet; review before changing'
config['inbounds']=[i for i in inbounds if i.get('port')==8443]
assert any(o.get('tag')=='block' and o.get('protocol')=='blackhole' for o in config['outbounds'])
rule={'type':'field','network':'tcp,udp','port':'25,465,587,2525','outboundTag':'block'}
routing=config.setdefault('routing',{})
rules=routing.setdefault('rules',[])
if rule not in rules: rules.insert(0,rule)
st=os.stat(path)
tmp=path+'.hardening-tmp'
with open(tmp,'w') as f: json.dump(config,f,indent=2); f.write('\n')
os.chown(tmp,st.st_uid,st.st_gid)
os.chmod(tmp,0o640)
os.replace(tmp,path)
PY
/usr/local/bin/xray run -test -config /usr/local/etc/xray/config.json
install -d -m 755 /etc/systemd/system/xray.service.d
cat > /etc/systemd/system/xray.service.d/90-vps-hardening.conf <<'XRAY'
[Service]
CapabilityBoundingSet=
AmbientCapabilities=
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
RestrictNamespaces=yes
LockPersonality=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
ReadWritePaths=/run/xray
UMask=0077
XRAY
systemctl daemon-reload
systemctl restart xray
systemctl is-active --quiet xray

cat > "$BACKUP/rules.after.v4" <<'IPV4'
*filter
:INPUT DROP [0:0]
:FORWARD DROP [0:0]
:OUTPUT ACCEPT [0:0]
-A INPUT -i lo -j ACCEPT
-A INPUT -m conntrack --ctstate INVALID -j DROP
-A INPUT -p tcp -m multiport --dports 25,465,587,2525 -j REJECT --reject-with tcp-reset
-A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
-A INPUT -p icmp -j ACCEPT
-A INPUT -p udp --sport 67 --dport 68 -j ACCEPT
-A INPUT -p tcp -m multiport --dports 22,8443 -m conntrack --ctstate NEW -j ACCEPT
-A OUTPUT -o lo -j ACCEPT
-A OUTPUT -p tcp -m multiport --dports 25,465,587,2525 -m limit --limit 3/min --limit-burst 5 -j LOG --log-prefix "SMTPBLK4 " --log-level 6
-A OUTPUT -p tcp -m multiport --dports 25,465,587,2525 -j REJECT --reject-with tcp-reset
-A OUTPUT -p udp -m multiport --dports 25,465,587,2525 -j REJECT --reject-with icmp-port-unreachable
COMMIT
IPV4
cat > "$BACKUP/rules.after.v6" <<'IPV6'
*filter
:INPUT DROP [0:0]
:FORWARD DROP [0:0]
:OUTPUT ACCEPT [0:0]
-A INPUT -i lo -j ACCEPT
-A INPUT -m conntrack --ctstate INVALID -j DROP
-A INPUT -p tcp -m multiport --dports 25,465,587,2525 -j REJECT --reject-with tcp-reset
-A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
-A INPUT -p ipv6-icmp -j ACCEPT
-A INPUT -s fe80::/10 -p udp --sport 547 --dport 546 -j ACCEPT
-A INPUT -p tcp -m multiport --dports 22,8443 -m conntrack --ctstate NEW -j ACCEPT
-A OUTPUT -o lo -j ACCEPT
-A OUTPUT -p tcp -m multiport --dports 25,465,587,2525 -m limit --limit 3/min --limit-burst 5 -j LOG --log-prefix "SMTPBLK6 " --log-level 6
-A OUTPUT -p tcp -m multiport --dports 25,465,587,2525 -j REJECT --reject-with tcp-reset
-A OUTPUT -p udp -m multiport --dports 25,465,587,2525 -j REJECT --reject-with icmp6-port-unreachable
COMMIT
IPV6
iptables-restore --test < "$BACKUP/rules.after.v4"
ip6tables-restore --test < "$BACKUP/rules.after.v6"
iptables-restore < "$BACKUP/rules.after.v4"
ip6tables-restore < "$BACKUP/rules.after.v6"
install -m 600 "$BACKUP/rules.after.v4" /etc/iptables/rules.v4
install -m 600 "$BACKUP/rules.after.v6" /etc/iptables/rules.v6
systemctl enable netfilter-persistent.service
systemctl disable smtp-block.service
# Reload from the saved boot configuration to verify persistence without reboot.
netfilter-persistent reload
if systemctl is-active --quiet fail2ban; then systemctl restart fail2ban; fi
systemctl mask atd.service
printf '%s\n' "$BACKUP" > /root/vps-hardening-latest
chmod 600 /root/vps-hardening-latest
trap - ERR
printf '\nAPPLIED; independent verification required before stopping rollback timer.\nBackup: %s\n' "$BACKUP"
/usr/sbin/sshd -T | grep -E '^(authenticationmethods|permitrootlogin|passwordauthentication|kbdinteractiveauthentication|disableforwarding|maxauthtries) '
systemctl show xray -p User -p CapabilityBoundingSet -p AmbientCapabilities -p ProtectSystem -p ProtectHome
ss -lntp
