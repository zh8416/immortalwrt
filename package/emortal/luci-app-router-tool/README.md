# Router Tool wireless defaults

Build systems may set the optional wireless defaults in `/etc/config/router-tool`:

```uci
config settings 'main'

config wireless 'defaults'
	option ssid_prefix 'Home'
	option key 'example-password'
```

`ssid_prefix` replaces the hostname part of the generated SSID. For example,
`Home` produces `Home-Redmi-2.4G` and `Home-Redmi-5.2G`. Hostname and prefix case
are preserved, and the vendor's first letter is capitalized. The suffix follows
the radio's capabilities (`2.4G`, `5.2G`, `5.8G`, or `6G`). Names are shortened
to 32 bytes without splitting UTF-8 characters. Omit the prefix to use the system
hostname. The password defaults to `12345678` if omitted; an explicit value must
contain 8 to 63 printable ASCII characters, supporting both WPA2 and WPA3-SAE.

These settings are initialization defaults. Only unmarked, untouched APs with
`OWRT` / `12345678` / `psk2+ccmp` are initialized. Existing custom credentials,
STA/mesh/WDS/MLO profiles, and radios with `defaults_done=1` are preserved.
Subsequent LuCI edits and upgrades that retain configuration do not reapply the
build defaults. Do not clear the markers to enforce new credentials on an
already configured router; edit its Wireless form instead.

OpenWRT-CI passes `WRT_SSID` and `WRT_WORD` through this section. It must leave
the wifi-scripts generator's untouched-AP values intact, so custom build
credentials do not suppress channel, bandwidth, country, and security defaults.
Keep this configuration private when using a private Wi-Fi password.
