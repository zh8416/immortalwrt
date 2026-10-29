# NSS Wi-Fi control

The service chooses WLAN ring ownership before ath11k probes. Change
`nss-wifi.general.offload` or firmware parameters and reboot to apply them.
Keep the service enabled even when selecting the host path with `offload=0`.
An interrupted bring-up leaves `/etc/nss-wifi.pending`; the following boot
uses host rings. Remove that file before rebooting to retry NSS.

The core-0 platform device exposes these sysfs attributes independently of
debugfs (normally `/sys/bus/platform/devices/39000000.nss`):

| Attribute | Access | Contents |
| --- | --- | --- |
| `boot` | read/write | Core running flag; write a boolean to boot or stop it. |
| `wifi_start` | write | Write `1` to initialize all fully described WLAN instances. Errors are returned to the writer. |
| `state` | read | Current physical target count, registered/described/started instances, readiness, VDEV/peer counts and per-instance errors. |
| `flow_stats` | read | IPv4, IPv6, total installed bidirectional rules, total firmware capacity. |

`ready=1` requires a running core and every expected on-chip/eligible PCI
instance. VDEVs are created later by netifd and are not a boot prerequisite.
The persistent guard is cleared only after 120 seconds and a fresh healthy
state check. Repeated service actions preserve a healthy running instance.

An authorization transport or firmware error stops the NSS processor before
returning the error. Shared DMA is retained until WLAN reset has stopped the
radios. A reboot is required to re-enable offload after this failure.

Normal builds omit action-on-read debugfs probes and experimental ath11k
ring ownership parameters. `CONFIG_NSS_WIFI_DEBUG=y` explicitly enables
them; passive counters and error diagnostics remain available by default.
`log_poll_us` accepts 100 through 1000000 microseconds; its default remains
200 until fault-log retention and CPU measurements justify a change.
