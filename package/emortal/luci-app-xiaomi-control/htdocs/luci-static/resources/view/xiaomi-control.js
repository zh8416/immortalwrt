'use strict';
'require view';
'require form';
'require uci';
'require fs';
'require rpc';
'require poll';
'require dom';
'require ui';

const callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: [ 'name' ],
	expect: { '': {} }
});

const callSystemBoard = rpc.declare({ object: 'system', method: 'board', expect: { '': {} } });

const callBe7000RadioStatus = rpc.declare({ object: 'be7000.radio', method: 'status', expect: {} });
const callBe7000RadioSet = rpc.declare({ object: 'be7000.radio', method: 'set', params: [ 'mode' ], expect: {} });
const callSystemReboot = rpc.declare({ object: 'system', method: 'reboot', expect: { result: 0 } });

function radioOptions(section) {
	section.tab('radio', _('RF mode'));

	let o = section.taboption('radio', form.DummyValue, '_radio_status', _('Runtime status'));
	o.renderWidget = function() { return section.map.radioStatus; };

	o = section.taboption('radio', form.DummyValue, '_radio_mode', _('5 GHz radio mode'));
	o.renderWidget = function() { return section.map.radioSelect; };

	o = section.taboption('radio', form.DummyValue, '_radio_apply', _('Apply mode'));
	o.renderWidget = function() { return section.map.radioApply; };
}

function nfcOptions(section) {
	section.tab('nfc', 'NFC');
	let o = section.taboption('nfc', form.DummyValue, '_nfc_status', _('Runtime status'));
	o.renderWidget = function() { return section.map.nfcStatus; };
	o = section.taboption('nfc', form.Flag, 'nfc_enabled', _('Enable NFC'),
		_('Disabling NFC clears the tag. Saved content is restored at boot and when wireless settings change. WPA3-only networks are not supported.'));
	o.default = '0';
	o.rmempty = false;
	function option(type, name, title, mode) {
		const value = section.taboption('nfc', type, 'nfc_' + name, title);
		value.retain = true;
		value.depends(mode ? { nfc_enabled: '1', nfc_mode: mode } : { nfc_enabled: '1' });
		return value;
	}
	const size = function(value) { return new TextEncoder().encode(value || '').length; };
	o = option(form.ListValue, 'mode', _('Tag content'));
	[ [ 'wifi', _('Router Wi-Fi') ], [ 'text', _('Text') ],
		[ 'uri', _('Link (URI)') ], [ 'manual', _('Manual Wi-Fi') ] ].forEach(function(entry) { o.value(entry[0], entry[1]); });
	o.default = 'wifi';
	o.rmempty = false;
	o = option(form.ListValue, 'iface', _('Access point'), 'wifi');
	uci.sections('wireless', 'wifi-iface').forEach(function(ap) {
		if (ap.mode === 'ap') o.value(ap['.name'], '%s · %s'.format(ap.ssid || ap['.name'], ap.device || ''));
	});
	o.validate = function(section_id, value) {
		const ap = uci.get('wireless', value);
		const radios = ap && (Array.isArray(ap.device) ? ap.device : (ap.device || '').split(/\s+/));
		return !!(ap && ap.mode === 'ap' && ap.disabled !== '1' && radios.length &&
			radios.every(function(id) { return uci.get('wireless', id) && uci.get('wireless', id, 'disabled') !== '1'; }) &&
			/^(none|psk(?:\+tkip)?|psk2(?:\+(?:ccmp|aes))?|(?:psk|sae)-mixed(?:\+ccmp)?)$/.test(ap.encryption || 'none')) ||
			_('Selected AP is unavailable or uses unsupported security.');
	};
	o = option(form.TextValue, 'text', _('Text'), 'text');
	o.rows = 6;
	o.description = _('Maximum 1900 UTF-8 bytes.');
	o.validate = function(section_id, value) { return (size(value) > 0 && size(value) <= 1900) || _('Text must contain 1–1900 UTF-8 bytes.'); };
	o = option(form.Value, 'uri', _('URL'), 'uri');
	o.placeholder = 'https://example.com';
	o.validate = function(section_id, value) {
		return (size(value) <= 1900 && /^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s\x00-\x1f\x7f]*$/.test(value || '')) || _('Enter a valid URI (up to 1900 UTF-8 bytes).');
	};
	o = option(form.Value, 'manual_ssid', _('Network name (SSID)'), 'manual');
	o.validate = function(section_id, value) { return (size(value) > 0 && size(value) <= 32) || _('SSID must contain 1–32 UTF-8 bytes.'); };
	const security = option(form.ListValue, 'security', _('Encryption'), 'manual');
	security.value('wpa2', 'WPA2-Personal');
	security.value('none', _('No password'));
	security.default = 'wpa2';
	security.rmempty = false;
	o = section.taboption('nfc', form.Value, 'nfc_manual_key', _('Password'));
	o.password = true;
	o.retain = true;
	o.depends({ nfc_enabled: '1', nfc_mode: 'manual', nfc_security: 'wpa2' });
	o.validate = function(section_id, value) {
		return ((size(value) >= 8 && size(value) <= 63) || /^[a-fA-F0-9]{64}$/.test(value || '')) || _('Password must contain 8–63 bytes or 64 hexadecimal digits.');
	};
}

const ColorValue = form.Value.extend({
	renderWidget: function(section_id, option_index, cfgvalue) {
		const value = /^#[0-9a-fA-F]{6}$/.test(cfgvalue || '') ? cfgvalue : this.default;
		const widget = this.super('renderWidget', [ section_id, option_index, value ]);
		const input = widget.querySelector('input') || widget;
		const picker = E('input', {
			type: 'color', value: value, title: _('Choose a color'),
			style: 'width:3.5em;margin-left:.5em',
			change: function(ev) {
				input.value = ev.target.value;
				input.dispatchEvent(new Event('change', { bubbles: true }));
			}
		});
		input.addEventListener('input', function() {
			if (/^#[0-9a-fA-F]{6}$/.test(input.value))
				picker.value = input.value;
		});
		return E('div', { style: 'display:flex;align-items:center' }, [ widget, picker ]);
	}
});

function validateColor(section_id, value) {
	return /^#[0-9a-fA-F]{6}$/.test(value || '') || _('Enter a color in #RRGGBB format.');
}

function validateTime(section_id, value) {
	return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value || '') || _('Enter a time in HH:MM format.');
}

function fault(error) {
	const messages = {
		'fan-unavailable': _('Fan controller unavailable'),
		'temperature-unavailable': _('Temperature unavailable; requesting full fan speed'),
		'pwm-read-failed': _('Unable to read fan output; requesting full speed'),
		'pwm-write-failed': _('Unable to confirm fan output; requesting full speed'),
		'fan-stalled': _('Fan stalled; requesting full speed'),
		'fan-control-failed': _('Fan control failed; requesting full speed'),
		'led-write-failed': _('Unable to write RGB lighting output'),
		'led-control-failed': _('RGB lighting control failed')
	};
	return error ? (messages[error] || _('Unknown error')) : _('None');
}

function nfcFault(error) {
	const rollback = ' NFC rollback failed.';
	const invalid = 'Invalid NFC option: ';
	if (error.endsWith(rollback))
		return '%s %s'.format(nfcFault(error.slice(0, -rollback.length)), _('NFC rollback failed.'));
	if (error.startsWith(invalid))
		return _('Invalid NFC option: %s').format(error.slice(invalid.length));
	return _(error);
}

const FAN_HISTORY_WINDOW_MS = 2 * 60 * 1000;
const FAN_TIME_GRID_MS = 10 * 1000;
const FAN_TIME_LABEL_MS = 30 * 1000;
const FAN_VALUE_DIVISIONS = 4;

function fanValidNumber(value) {
	const n = Number(value);
	return Number.isFinite(n) && n >= 0 ? n : null;
}

function fanAppendHistory(history, running, fan) {
	const now = Date.now();
	const temperature = fanValidNumber(fan.temperature);
	const pwm = fanValidNumber(fan.pwm);
	const rpm = fanValidNumber(fan.rpm);
	history.push({
		time: now,
		temperature: running && temperature != null ? temperature / 1000 : null,
		pwm: running && pwm != null ? pwm * 100 / 255 : null,
		rpm: running ? rpm : null
	});
	while (history.length && history[0].time < now - FAN_HISTORY_WINDOW_MS)
		history.shift();
}

function fanChartScale(history, key, minimumMax, step) {
	let maximum = minimumMax;
	history.forEach(function(sample) {
		if (sample[key] != null)
			maximum = Math.max(maximum, sample[key]);
	});
	return Math.ceil(maximum / step) * step;
}

function fanDrawChart(canvas, history, key, options) {
	if (!canvas)
		return;
	const style = window.getComputedStyle(canvas);
	const width = Math.max(canvas.clientWidth, 1);
	const height = Math.max(canvas.clientHeight, 1);
	const ratio = Math.min(window.devicePixelRatio || 1, 2);
	const context = canvas.getContext('2d');
	if (!context)
		return;
	const padding = { left: 28, right: 5, top: 6, bottom: 14 };
	const plotWidth = Math.max(width - padding.left - padding.right, 1);
	const plotHeight = Math.max(height - padding.top - padding.bottom, 1);
	const plotBottom = padding.top + plotHeight;
	const now = history.length ? history[history.length - 1].time : Date.now();
	const start = now - FAN_HISTORY_WINDOW_MS;
	const maximum = fanChartScale(history, key, options.minimumMax, options.step);
	const lineColor = style.getPropertyValue('--fancontrol-chart-line').trim() || '#1976d2';
	const fillColor = style.getPropertyValue('--fancontrol-chart-fill').trim() || 'rgba(25, 118, 210, .2)';
	const labelColor = style.color || '#666';
	const gridColor = 'rgba(127, 127, 127, .2)';
	let segment = [];
	canvas.width = Math.round(width * ratio);
	canvas.height = Math.round(height * ratio);
	context.setTransform(ratio, 0, 0, ratio, 0, 0);
	context.clearRect(0, 0, width, height);
	context.strokeStyle = gridColor;
	context.lineWidth = 1;
	context.beginPath();
	for (let elapsed = 0; elapsed <= FAN_HISTORY_WINDOW_MS; elapsed += FAN_TIME_GRID_MS) {
		const x = padding.left + plotWidth * elapsed / FAN_HISTORY_WINDOW_MS;
		context.moveTo(x, padding.top);
		context.lineTo(x, plotBottom);
	}
	for (let division = 0; division <= FAN_VALUE_DIVISIONS; division++) {
		const y = padding.top + plotHeight * division / FAN_VALUE_DIVISIONS;
		context.moveTo(padding.left, y);
		context.lineTo(padding.left + plotWidth, y);
	}
	context.stroke();
	context.fillStyle = labelColor;
	context.font = '9px sans-serif';
	context.textAlign = 'right';
	context.textBaseline = 'top';
	context.fillText(options.format(maximum), padding.left - 4, padding.top - 1);
	context.textBaseline = 'bottom';
	context.fillText(options.format(0), padding.left - 4, plotBottom + 1);
	context.textBaseline = 'middle';
	context.fillText(options.format(maximum / 2), padding.left - 4, padding.top + plotHeight / 2);
	context.textBaseline = 'bottom';
	for (let elapsed = 0; elapsed <= FAN_HISTORY_WINDOW_MS; elapsed += FAN_TIME_LABEL_MS) {
		const x = padding.left + plotWidth * elapsed / FAN_HISTORY_WINDOW_MS;
		const remaining = (FAN_HISTORY_WINDOW_MS - elapsed) / 1000;
		context.textAlign = elapsed === 0 ? 'left' : elapsed === FAN_HISTORY_WINDOW_MS ? 'right' : 'center';
		context.fillText(remaining ? '-%ds'.format(remaining) : '0', x, height);
	}
	const point = function(sample) {
		return {
			x: padding.left + (sample.time - start) / FAN_HISTORY_WINDOW_MS * plotWidth,
			y: plotBottom - sample[key] / maximum * plotHeight
		};
	};
	const drawSegment = function() {
		if (!segment.length)
			return;
		if (segment.length > 1) {
			context.beginPath();
			context.moveTo(segment[0].x, plotBottom);
			segment.forEach(function(item) { context.lineTo(item.x, item.y); });
			context.lineTo(segment[segment.length - 1].x, plotBottom);
			context.closePath();
			context.fillStyle = fillColor;
			context.fill();
			context.beginPath();
			segment.forEach(function(item, index) {
				if (index)
					context.lineTo(item.x, item.y);
				else
					context.moveTo(item.x, item.y);
			});
			context.strokeStyle = lineColor;
			context.lineWidth = 1.5;
			context.lineJoin = 'round';
			context.stroke();
		}
		else {
			context.beginPath();
			context.arc(segment[0].x, segment[0].y, 2, 0, Math.PI * 2);
			context.fillStyle = lineColor;
			context.fill();
		}
		segment = [];
	};
	history.forEach(function(sample) {
		if (sample[key] == null) {
			drawSegment();
			return;
		}
		segment.push(point(sample));
	});
	drawSegment();
}

function fanStatusMetric(title, value, unit, chartClass) {
	const canvas = E('canvas', {
		'class': 'fancontrol-chart fancontrol-chart-%s'.format(chartClass),
		'role': 'img',
		'aria-label': title
	});
	const node = E('div', { 'class': 'fancontrol-metric' }, [
		E('span', { 'class': 'fancontrol-metric-label' }, title),
		E('div', { 'class': 'fancontrol-metric-reading' }, [
			E('span', { 'class': 'fancontrol-metric-value' }, value),
			unit ? E('span', { 'class': 'fancontrol-metric-unit' }, unit) : ''
		]),
		E('div', { 'class': 'fancontrol-chart-wrap' }, canvas)
	]);
	return { node: node, canvas: canvas };
}

function fanStatusDetail(title, value) {
	return E('div', { 'class': 'fancontrol-detail' }, [
		E('span', { 'class': 'fancontrol-detail-label' }, title),
		E('span', { 'class': 'fancontrol-detail-value' }, value)
	]);
}

function fanRenderStatus(node, running, fan, history) {
	const temp = fanValidNumber(fan.temperature);
	const pwm = fanValidNumber(fan.pwm);
	const rpm = fanValidNumber(fan.rpm);
	const pwmPercent = pwm != null ? Math.round(pwm * 100 / 255) : null;
	const temperatureMetric = fanStatusMetric(_('Temperature'),
		temp != null ? '%.1f'.format(temp / 1000) : '-', temp != null ? '°C' : '', 'temperature');
	const pwmMetric = fanStatusMetric(_('PWM output'),
		pwm != null ? String(pwm) : '-', pwm != null ? '/ 255 · %d%%'.format(pwmPercent) : '', 'pwm');
	const rpmMetric = fanStatusMetric(_('Fan speed'),
		rpm != null ? String(rpm) : '-', rpm != null ? 'RPM' : '', 'rpm');
	dom.content(node, E('div', { 'class': 'fancontrol-status' }, [
		E('div', { 'class': 'fancontrol-status-head' }, [
			E('span', { 'class': 'fancontrol-status-title' }, _('Runtime Status')),
			E('span', { 'class': running ? 'label success' : 'label warning' },
				running ? _('Running') : _('Stopped'))
		]),
		E('div', { 'class': 'fancontrol-metrics' }, [
			temperatureMetric.node, pwmMetric.node, rpmMetric.node
		]),
		E('div', { 'class': 'fancontrol-details' }, [
			fanStatusDetail(_('Hottest sensor'), fan.sensor || '-'),
			fanStatusDetail(_('Valid sensors'),
				typeof fan.sensors == 'number' && Number.isFinite(fan.sensors) ? String(fan.sensors) : '-'),
			fanStatusDetail(_('Profile'), fan.profile || '-'),
			fanStatusDetail(_('Fault'), fault(fan.error))
		])
	]));
	fanDrawChart(temperatureMetric.canvas, history, 'temperature',
		{ minimumMax: 100, step: 10, format: function(v) { return '%d°'.format(v); } });
	fanDrawChart(pwmMetric.canvas, history, 'pwm',
		{ minimumMax: 100, step: 100, format: function(v) { return '%d%%'.format(v); } });
	fanDrawChart(rpmMetric.canvas, history, 'rpm',
		{ minimumMax: 1000, step: 500, format: function(v) { return String(v); } });
}

function metric(label, value) {
	return E('div', { 'class': 'table-row' }, [
		E('div', { 'class': 'td left', style: 'width:40%' }, label),
		E('div', { 'class': 'td left' }, value)
	]);
}

return view.extend({
	load: function() {
		return Promise.all([ uci.load('xiaomi-control'), uci.load('wireless'), callSystemBoard() ]);
	},

	updateStatus: function() {
		return Promise.all([
			L.resolveDefault(fs.read('/var/run/xiaomi-control.json'), ''),
			L.resolveDefault(callServiceList('xiaomi-control'), {}),
			L.resolveDefault(fs.read('/var/run/xiaomi-nfc.json'), '')
		]).then(L.bind(function(result) {
			const instances = result[1]['xiaomi-control']?.instances || {};
			const running = Object.keys(instances).some(function(key) { return instances[key].running; });
			let status = {};
			try {
				const parsed = JSON.parse(result[0]);
				if (parsed && typeof parsed == 'object') status = parsed;
			} catch (e) { /* Status is not ready. */ }
			const fan = running ? (status.fan || {}) : {};
			const led = running ? (status.led || {}) : {};
			let nfc = {};
			try { nfc = JSON.parse(result[2]); } catch (e) { /* Not ready. */ }
			dom.content(this.nfcStatus, nfc.error ? nfcFault(nfc.error) : !nfc.available ? _('NFC hardware unavailable.') :
				nfc.enabled ? _('Written.') : _('NFC disabled.'));

			fanAppendHistory(this.fanHistory, running, fan);
			fanRenderStatus(this.fanStatus, running, fan, this.fanHistory);
			dom.content(this.ledStatus, running ? (!status.led ? _('Collecting data...') :
				(led.error ? fault(led.error) : _('Running'))) : _('Stopped'));
		}, this));
	},

	render: function(data) {
		const m = new form.Map('xiaomi-control', _('Xiaomi Control'),
			_('Fan, RGB lighting and NFC control for supported Xiaomi routers.'));
		const s = m.section(form.NamedSection, 'settings', 'control');
		s.addremove = false;
		this.fanStatus = E('div', {}, _('Collecting data...'));
		this.fanHistory = [];
		this.ledStatus = E('span', {}, _('Collecting data...'));
		this.nfcStatus = m.nfcStatus = E('span', {}, _('Collecting data...'));
		const boardName = data[2].board_name || '';
		if (/^xiaomi,be10000(?:-es)?$/.test(boardName)) {
			s.tab('fan', _('Fan'));
			s.tab('led', _('RGB lighting'));

			let o = s.taboption('fan', form.DummyValue, '_fan_status', _('Runtime status'));
			o.renderWidget = L.bind(function() { return this.fanStatus; }, this);
			o = s.taboption('fan', form.ListValue, 'profile', _('Fan profile'),
				_('Uses the highest valid thermal-zone temperature, with hysteresis, a startup boost and full-speed recovery on faults.'));
			o.value('auto', _('Automatic (45–85 °C)'));
			o.value('quiet', _('Quiet (52–80 °C)'));
			o.value('balanced', _('Balanced (45–75 °C)'));
			o.value('performance', _('Performance (38–65 °C)'));
			o.default = 'auto';
			o.rmempty = false;

			o = s.taboption('led', form.DummyValue, '_led_status', _('Runtime status'));
			o.renderWidget = L.bind(function() { return this.ledStatus; }, this);
			o = s.taboption('led', form.Flag, 'enabled', _('Enable RGB lighting'));
			o.default = o.enabled;
			o.rmempty = false;
			o = s.taboption('led', form.ListValue, 'mode', _('Lighting mode'));
			[
				[ 'static', _('Static') ], [ 'breathe', _('Breathing') ],
				[ 'duotone', _('Two-color fade') ], [ 'rainbow', _('Rainbow') ],
				[ 'temperature', _('Temperature') ], [ 'cpu', _('CPU load') ], [ 'traffic', _('Network traffic') ]
			].forEach(function(entry) { o.value(entry[0], entry[1]); });
			o.default = 'breathe';
			o.rmempty = false;
			o.depends('enabled', '1');

			function modes(option, values) {
				values.forEach(function(mode) { option.depends({ enabled: '1', mode: mode }); });
			}
			function slider(name, title, value, low, high, values) {
				const option = s.taboption('led', form.RangeSliderValue, name, title);
				option.min = low;
				option.max = high;
				option.step = 1;
				option.default = value;
				option.rmempty = false;
				// Keep default values for these required settings.
				option.formvalue = function(section_id) {
					const element = this.getUIElement(section_id);
					return element ? element.getValue() : null;
				};
				option.datatype = 'range(%d,%d)'.format(low, high);
				if (values) modes(option, values);
				else option.depends('enabled', '1');
				return option;
			}
			function timeOption(name, title, value, flag) {
				const option = s.taboption('led', form.Value, name, title);
				option.default = value;
				option.rmempty = false;
				option.validate = validateTime;
				const dependency = { enabled: '1' };
				dependency[flag] = '1';
				option.depends(dependency);
			}

			o = s.taboption('led', ColorValue, 'color', _('Primary color'));
			o.default = '#0000ff';
			o.rmempty = false;
			o.validate = validateColor;
			modes(o, [ 'static', 'breathe', 'duotone' ]);
			o = s.taboption('led', ColorValue, 'second_color', _('Secondary color'));
			o.default = '#ff00aa';
			o.rmempty = false;
			o.validate = validateColor;
			modes(o, [ 'duotone' ]);
			slider('brightness', _('Maximum brightness'), '96', 0, 255);
			slider('minimum_brightness', _('Minimum brightness'), '8', 0, 255, [ 'breathe' ]);
			slider('speed', _('Animation speed'), '5', 1, 10, [ 'breathe', 'duotone', 'rainbow' ]);
			slider('sensitivity', _('Sensitivity'), '5', 1, 10, [ 'temperature', 'cpu', 'traffic' ]);
			o = s.taboption('led', form.Value, 'traffic_interface', _('Traffic interface'),
				_('Logical interface or network device, for example wan or pppoe-wan.'));
			o.default = 'wan';
			o.rmempty = false;
			o.validate = function(section_id, value) {
				return /^[A-Za-z0-9_+.:@-]{1,15}$/.test(value || '') || _('Enter a valid interface or device name (up to 15 characters).');
			};
			modes(o, [ 'traffic' ]);

			o = s.taboption('led', form.Flag, 'schedule_enabled', _('Scheduled lighting'),
				_('Equal start and end times cover the whole day. Time ranges may cross midnight.'));
			o.rmempty = false;
			o.depends('enabled', '1');
			timeOption('on_time', _('On time'), '07:00', 'schedule_enabled');
			timeOption('off_time', _('Off time'), '23:30', 'schedule_enabled');
			o = s.taboption('led', form.Flag, 'night_enabled', _('Night brightness'));
			o.rmempty = false;
			o.depends('enabled', '1');
			timeOption('night_start', _('Night start'), '22:00', 'night_enabled');
			timeOption('night_end', _('Night end'), '07:00', 'night_enabled');
			o = slider('night_brightness', _('Maximum night brightness'), '24', 0, 255, []);
			o.depends({ enabled: '1', night_enabled: '1' });
		}
		nfcOptions(s);

		if (boardName === 'xiaomi,be7000') {
			this.radioStatus = m.radioStatus = E('span', {}, _('Collecting data...'));
			this.radioSelect = m.radioSelect = E('span');
			this.radioApply = m.radioApply = E('span');
			radioOptions(s);
		}

		return m.render().then(L.bind(function(node) {
			node.insertBefore(E('link', {
				'rel': 'stylesheet',
				'href': L.resource('view/xiaomi-control.css')
			}), node.firstChild);
			poll.add(L.bind(this.updateStatus, this), 5);
			if (boardName === 'xiaomi,be7000')
				this.setupRadio();
			return this.updateStatus().then(function() { return node; });
		}, this));
	},

	setupRadio: function() {
		const isDual = function(mode) { return mode === 'dual'; };
		const modeName = function(mode) { return isDual(mode) ? _('Tri-band') : _('Dual-band'); };

		const select = E('select', { 'class': 'cbi-input-select', 'style': 'min-width:24em' }, [
			E('option', { 'value': 'single' }, _('Dual-band: 2.4G 4x4 + 5G 4x4 (full band)')),
			E('option', { 'value': 'dual' }, _('Tri-band: 2.4G 4x4 + 5.2G 2x2 + 5.8G 2x2'))
		]);
		dom.content(this.radioSelect, E('div', {}, [
			select,
			E('p', { 'class': 'cbi-section-descr' },
				_('Switch between a single 5 GHz 4x4 radio (full band) and two 5 GHz 2x2 radios (5.2G + 5.8G). Changing the mode requires a reboot.'))
		]));

		const description = E('div', { 'class': 'cbi-section-descr' });
		const preview = E('p');
		const button = E('button', { 'class': 'cbi-button cbi-button-action important' }, _('Save and reboot'));
		const message = E('p', { 'role': 'status' });
		dom.content(this.radioApply, E('div', {}, [
			description, preview,
			E('p', {}, _('Switching reboots the router. Save your work first.')),
			button, message
		]));

		let state = {};
		let dirty = false;
		const describe = function() {
			const value = select.value;
			if (value === 'dual') {
				dom.content(description, E('div', {}, [
					E('p', {}, _('After switching: the 5G 4x4 radio is split into two independent 2x2 radios (5.2G + 5.8G).')),
					E('ul', {}, [
						E('li', {}, _('A new 5.8G SSID is added (channel 149 / 80 MHz), while your existing 2.4G and 5G names stay unchanged.')),
						E('li', {}, _('Password and encryption of the new 5.8G are inherited from the primary 5G.')),
						E('li', {}, _('Single-client peak and coverage drop; multi-client concurrency and a dedicated backhaul improve.'))
					])
				]));
			}
			else {
				dom.content(description, E('div', {}, [
					E('p', {}, _('After switching: restore a single 5G 4x4 radio covering the full band (160 MHz).')),
					E('ul', {}, [
						E('li', {}, _('The 5.8G entry is removed from the wireless page; all your SSIDs stay unchanged.')),
						E('li', {}, _('The 5.8G name is remembered, so it returns when you switch back to tri-band.'))
					])
				]));
			}
			dom.content(preview, _('SSIDs after switch: %s').format(state.ssid_preview || ''));
		};

		const refresh = L.bind(function() {
			return L.resolveDefault(callBe7000RadioStatus(), {}).then(L.bind(function(st) {
				if (!st || typeof st !== 'object') return;
				state = st;
				if (st.available === false) {
					dom.content(this.radioStatus, _('RF mode control is only available on the Xiaomi BE7000.'));
					return;
				}
				if (st.error)
					dom.content(this.radioStatus, _('Error: %s').format(st.error));
				else if (st.pending)
					dom.content(this.radioStatus, _('Current: %s | Selected: %s | effective after reboot')
						.format(modeName(st.current), modeName(st.selected)));
				else
					dom.content(this.radioStatus, _('Current: %s').format(modeName(st.current)));
				if (!dirty)
					select.value = st.selected || 'single';
				describe();
			}, this));
		}, this);

		select.addEventListener('change', function() {
			dirty = true;
			describe();
		});
		button.addEventListener('click', L.bind(function() {
			button.disabled = true;
			message.textContent = _('Saving...');
			callBe7000RadioSet(select.value).then(function(res) {
				if (res && res.error) throw new Error(res.error);
				return callSystemReboot();
			}).then(function() {
				ui.showModal(_('Rebooting...'), [ E('p', { 'class': 'spinning' }, _('Waiting for the device to come back...')) ]);
				ui.awaitReconnect();
			}).catch(function(err) {
				ui.addNotification(null, E('p', {}, err.message), 'error');
				message.textContent = '';
				button.disabled = false;
			});
		}, this));

		poll.add(refresh, 5);
		return refresh();
	}
});
