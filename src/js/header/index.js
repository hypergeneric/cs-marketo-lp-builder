function extractVidyardUuid(src) {
	try {
		var urlObj = new URL(src, window.location.origin);
		var pathname = urlObj.pathname || '';
		var parts = pathname.split('/').filter(function (part) {
			return part !== '';
		});

		if (parts.length === 0) {
			return null;
		}

		// Last path segment, strip extension if present
		var last = parts[parts.length - 1];
		var dotIndex = last.indexOf('.');

		if (dotIndex !== -1) {
			last = last.slice(0, dotIndex);
		}

		return last || null;
	} catch (e) {
		// Fallback: very simple parse if URL() fails
		var path = src.split('?')[0];
		var segments = path.split('/');

		if (segments.length === 0) {
			return null;
		}

		var tail = segments[segments.length - 1];
		var dot = tail.indexOf('.');

		if (dot !== -1) {
			tail = tail.slice(0, dot);
		}

		return tail || null;
	}
}
function launchLightbox(uuid) {
	if (!window.VidyardV4 || !VidyardV4.api) {
		return;
	}
	var players = VidyardV4.api.getPlayersByUUID(uuid);
	if (players && players[0]) {
		players[0].showLightbox();
	}
}
