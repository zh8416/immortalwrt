#!/usr/bin/env python3
"""Inject the BE7000 radio-mode control into luci-mod-network's wireless view.

Invoked from the build workflow right after `./scripts/feeds install -a`.
Idempotent: a marker prevents double injection. Fails loudly if the LuCI
source no longer matches the expected anchor, instead of silently shipping
a build without the control.
"""
import sys, re, pathlib

MARKER = "BE7000_RADIO_INJECTED"

JS = r"""
			/* BE7000_RADIO_INJECTED - Xiaomi BE7000 dual/tri-band control */
			try {
				var be7000Status = rpc.declare({ object: 'be7000.radio', method: 'status', expect: {} });
				var be7000Set = rpc.declare({ object: 'be7000.radio', method: 'set', params: [ 'mode' ], expect: {} });
				var be7000Reboot = rpc.declare({ object: 'system', method: 'reboot', expect: { result: 0 } });

				be7000Status().then(function(st) {
					if (!st || !st.available || st.available == 0) return;

					var box = E('div', { 'class': 'cbi-section', 'id': 'be7000-radio-mode' });
					box.appendChild(E('h3', {}, _('5 GHz 频段模式（Xiaomi BE7000）')));
					var current = E('p', {});
					var select = E('select', { 'class': 'cbi-input-select', 'style': 'min-width:24em' });
					select.appendChild(E('option', { 'value': 'single' }, _('双频：2.4G 4×4 + 5G 4×4（160MHz 全频段）')));
					select.appendChild(E('option', { 'value': 'dual' }, _('三频：2.4G 4×4 + 5.2G 2×2 + 5.8G 2×2')));
					select.value = st.selected || 'single';
					var desc = E('div', { 'class': 'cbi-section-descr' });
					var preview = E('p', {});
					var button = E('button', { 'class': 'cbi-button cbi-button-action important' }, _('保存并重启'));
					var message = E('p', { 'role': 'status' });

					function describe(value) {
						var base = st.ssid_base || 'OWRT-Xiaomi';
						if (value === 'dual') {
							dom.content(desc, E('div', {}, [
								E('p', {}, _('切换后的变化：2.4G 保持不变，原来的 5G 4×4 射频拆分成两个 2×2 独立射频。')),
								E('ul', {}, [
									E('li', {}, _('新增 SSID：%s-5.8G（信道 149 / 80MHz），可用于独立回程或游戏专用').format(base)),
									E('li', {}, _('主 5G 改名为 %s-5.2G（信道 36 / 80MHz），密码与加密方式自动继承').format(base)),
									E('li', {}, _('单客户端峰值下降（4×4 → 2×2），信号覆盖略弱；多设备并发与独立回程更有优势')),
									E('li', {}, _('切换需重启路由器，现有 Wi-Fi 名称基名与密码保留'))
								])
							]));
						} else {
							dom.content(desc, E('div', {}, [
								E('p', {}, _('切换后的变化：恢复单个 5G 4×4 射频，覆盖 5.2G/5.8G 全段，160MHz。')),
								E('ul', {}, [
									E('li', {}, _('SSID 变回 %s-5G；第三频配置保留但停用，不会删除').format(base)),
									E('li', {}, _('单客户端峰值与覆盖恢复最佳；切换需重启路由器'))
								])
							]));
						}
					}

					function refresh() {
						current.textContent = (st.pending && st.pending != 0)
							? _('当前运行：%s ｜ 已选择：%s ｜ 重启后生效').format(
								st.current === 'dual' ? _('三频') : _('双频'),
								select.value === 'dual' ? _('三频') : _('双频'))
							: _('当前运行：%s').format(st.current === 'dual' ? _('三频') : _('双频'));
						preview.textContent = _('切换后 SSID：%s').format(st.ssid_preview || '');
						describe(select.value);
					}

					select.addEventListener('change', refresh);
					button.addEventListener('click', function() {
						button.disabled = true;
						message.textContent = _('正在保存…');
						be7000Set(select.value).then(function(res) {
							if (res && res.error) throw new Error(res.error);
							return be7000Reboot();
						}).then(function() {
							ui.showModal(_('正在重启…'), [ E('p', { 'class': 'spinning' }, _('等待设备重新上线…')) ]);
							ui.awaitReconnect();
						}).catch(function(err) {
							ui.addNotification(null, E('p', {}, err.message), 'error');
							message.textContent = '';
							button.disabled = false;
						});
					});

					box.appendChild(current);
					box.appendChild(E('label', { 'style': 'display:block;margin:.6em 0' }, [ _('模式：'), select ]));
					box.appendChild(desc);
					box.appendChild(preview);
					box.appendChild(E('p', {}, _('切换会重启路由器，请保存好正在进行的工作。')));
					box.appendChild(button);
					box.appendChild(message);
					refresh();

					if (nodes && nodes.appendChild)
						nodes.appendChild(box);
					else if (Array.isArray(nodes))
						nodes.push(box);
				}).catch(function() {});
			} catch (e) { }
"""

def main():
    if len(sys.argv) != 2:
        print("usage: inject-luci.py <path-to-wireless.js>", file=sys.stderr)
        return 2
    p = pathlib.Path(sys.argv[1])
    text = p.read_text(encoding="utf-8")
    if MARKER in text:
        print("inject-luci: already injected, nothing to do")
        return 0
    m = re.search(r"^(\s*)return m\.render\(\)\.then\(L\.bind\(function\(m, nodes\) \{\n",
                  text, re.M)
    if not m:
        print("inject-luci: ERROR - anchor not found in %s" % p, file=sys.stderr)
        print("LuCI wireless.js layout changed; the BE7000 control cannot be injected.", file=sys.stderr)
        return 1
    injected = text[:m.end()] + JS + text[m.end():]
    p.write_text(injected, encoding="utf-8")
    print("inject-luci: injected BE7000 radio mode control into %s" % p)
    return 0

if __name__ == "__main__":
    sys.exit(main())
