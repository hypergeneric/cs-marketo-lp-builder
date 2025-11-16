document.addEventListener('DOMContentLoaded', () => {
	const qs  = new URLSearchParams(location.search);
	const xid = qs.get('ps_xid')?.trim();
	const pky = qs.get('ps_partner_key')?.trim();
	if (!xid && !pky) return;

	const SELECTOR = 'a.cta-buy[href]';

	function decorate(href) {
		try {
			const u = new URL(href, location.href);
			if (!/^https?:$/i.test(u.protocol)) return href;

			if (xid && !u.searchParams.has('ps_xid')) u.searchParams.set('ps_xid', xid);
			if (pky && !u.searchParams.has('ps_partner_key')) u.searchParams.set('ps_partner_key', pky);
			return u.toString();
		} catch {
			return href;
		}
	}

	function updateAll() {
		document.querySelectorAll(SELECTOR).forEach(a => {
			a.href = decorate(a.href);
		});
	}

	updateAll();

	document.addEventListener('click', e => {
		const target = e.target;
		if (!(target instanceof Element)) return;
		const a = target.closest(SELECTOR);
		if (a) a.href = decorate(a.href);
	});
});
