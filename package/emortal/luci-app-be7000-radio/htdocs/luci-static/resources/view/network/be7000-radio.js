'use strict';
'require view';
'require rpc';
'require ui';

var be7000Status = rpc.declare({ object: 'be7000.radio', method: 'status', expect: {} });
var be7000Set = rpc.declare({ object: 'be7000.radio', method: 'set', params: [ 'mode' ], expect: {} });
var be7000Reboot = rpc.declare({ object: 'system', method: 'reboot', expect: { result: 0 } });

return view.extend({
	load: function() { return be7000Status(); },

	render: function(st) {
		if (!st || !st.available)
			return E('div', { 'class': 'cbi-section' }, E('p', {}, _('This page is only available on the Xiaomi BE7000.')));

		var box = E('div', { 'class': 'cbi-section', id: 'be7000-radio-mode' });
		box.appendChild(E('h2', {}, _('5 GHz radio mode (Xiaomi BE7000)')));
		box.appendChild(E('p', { 'class': 'cbi-section-descr' }, _('Switch between a single 5 GHz 4x4 radio (160 MHz full band) and two 5 GHz 2x2 radios (5.2G + 5.8G, 80 MHz each). Changing the mode requires a reboot.')));

		var current = E('p', {});
		var select = E('select', { 'class': 'cbi-input-select', 'style': 'min-width:24em' });
		select.appendChild(E('option', { 'value': 'single' }, _('Dual-band: 2.4G 4x4 + 5G 4x4 (160 MHz full band)')));
		select.appendChild(E('option', { 'value': 'dual' }, _('Tri-band: 2.4G 4x4 + 5.2G 2x2 + 5.8G 2x2')));
		select.value = st.selected || 'single';
		var desc = E('div', { 'class': 'cbi-section-descr' });
		var preview = E('p', {});
		var button = E('button', { 'class': 'cbi-button cbi-button-action important' }, _('Save and reboot'));
		var message = E('p', { 'role': 'status' });

		function describe(value) {
			var base = st.ssid_base || 'OWRT-Xiaomi';
			if (value === 'dual') {
				dom.content(desc, E('div', {}, [
					E('p', {}, _('After switching: 2.4G stays unchanged; the original 5G 4x4 radio is split into two independent 2x2 radios.')),
					E('ul', {}, [
						E('li', {}, _('New SSID: %s-5.8G (channel 149 / 80 MHz), for a dedicated backhaul or gaming').format(base)),
						E('li', {}, _('Primary 5G renamed to %s-5.2G (channel 36 / 80 MHz); password and encryption inherited').format(base)),
						E('li', {}, _('Single-client peak drops (4x4 to 2x2); coverage slightly weaker; multi-client concurrency and dedicated backhaul improve')),
						E('li', {}, _('Switching reboots the router; SSID base and password are preserved'))
					])
				]));
			} else {
				dom.content(desc, E('div', {}, [
					E('p', {}, _('After switching: restore a single 5G 4x4 radio covering the full 5.2G/5.8G band, 160 MHz.')),
					E('ul', {}, [
						E('li', {}, _('SSID returns to %s-5G; the tri-band config is kept but disabled, never deleted').format(base)),
						E('li', {}, _('Single-client peak and coverage restored; switching reboots the router'))
					])
				]));
			}
		}

		function refresh() {
			current.textContent = (st.pending && st.pending != 0)
				? _('Current: %s | Selected: %s | effective after reboot').format(
					st.current === 'dual' ? _('Tri-band') : _('Dual-band'),
					select.value === 'dual' ? _('Tri-band') : _('Dual-band'))
				: _('Current: %s').format(st.current === 'dual' ? _('Tri-band') : _('Dual-band'));
			preview.textContent = _('SSIDs after switch: %s').format(st.ssid_preview || '');
			describe(select.value);
		}

		select.addEventListener('change', refresh);
		button.addEventListener('click', function() {
			button.disabled = true;
			message.textContent = _('Saving…');
			be7000Set(select.value).then(function(res) {
				if (res && res.error) throw new Error(res.error);
				return be7000Reboot();
			}).then(function() {
				ui.showModal(_('Rebooting…'), [ E('p', { 'class': 'spinning' }, _('Waiting for the device to come back…')) ]);
				ui.awaitReconnect();
			}).catch(function(err) {
				ui.addNotification(null, E('p', {}, err.message), 'error');
				message.textContent = '';
				button.disabled = false;
			});
		});

		box.appendChild(current);
		box.appendChild(E('p', {}, E('label', { 'style': 'display:block;margin:.6em 0' }, [ _('Mode:'), select ])));
		box.appendChild(desc);
		box.appendChild(preview);
		box.appendChild(E('p', {}, _('Switching reboots the router. Save your work first.')));
		box.appendChild(button);
		box.appendChild(message);
		refresh();

		return E('div', { 'class': 'cbi-section' }, [ box ]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
