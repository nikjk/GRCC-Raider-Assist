const required = (env, key) => {
  if (!env[key]) throw new Error(`Server configuration missing: ${key}`);
  return env[key];
};

function id(env, key) {
  const result = Number(required(env, key));
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new Error(`Invalid numeric server configuration: ${key}`);
  }
  return result;
}

const normalizeSerial = (value) => String(value ?? '').trim().toUpperCase();
const assetIdOf = (value) => Number(value?.ID ?? value?.AssetID ?? value?.AssetId);


const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[character]);
const htmlParagraphs = value => String(value ?? '').split(/\n\s*\n/).filter(Boolean)
  .map(part => `<p>${escapeHtml(part).replace(/\n/g,'<br>')}</p>`).join('');
const htmlTable = rows => `<table><tbody>${rows.map(([label,value])=>
  `<tr><th scope="row" style="text-align:left;padding:5px 12px 5px 0">${escapeHtml(label)}</th>`+
  `<td style="padding:5px 0">${escapeHtml(value)}</td></tr>`).join('')}</tbody></table>`;
const roundMetric = (n,suffix='') => Number.isFinite(n)?`${Math.round(n*10)/10}${suffix}`:'Unavailable';

export class TeamDynamix {
  constructor(env = process.env) {
    this.env = env;
    this.base = required(env, 'TDX_BASE_URL').replace(/\/$/, '');
    this.ticketApp = env.TDX_TICKET_APP_ID ? id(env, 'TDX_TICKET_APP_ID') : null;
    this.assetApp = env.TDX_ASSET_APP_ID ? id(env, 'TDX_ASSET_APP_ID') : null;
    this.token = '';
    this.exp = 0;
  }

  async auth() {
    if (this.token && Date.now() < this.exp) return this.token;
    const response = await fetch(`${this.base}/api/auth/loginadmin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        BEID: required(this.env, 'TDX_BEID'),
        WebServicesKey: required(this.env, 'TDX_WS_KEY')
      }),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error(`TeamDynamix authentication failed (${response.status})`);
    this.token = (await response.text()).replace(/^"|"$/g, '').trim();
    this.exp = Date.now() + 20 * 60 * 1000;
    return this.token;
  }

  async request(path, method = 'GET', body) {
    const token = await this.auth();
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
    const content = await response.text();
    if (!response.ok) {
      if (response.status === 401) {
        this.token = '';
        this.exp = 0;
      }
      throw new Error(`TeamDynamix ${method} ${path} failed (${response.status}): ${content.slice(0, 220)}`);
    }
    if (!content) return null;
    try { return JSON.parse(content); } catch { return content; }
  }

  async getLocations() {
    const raw = await this.request('/api/locations');
    if (!Array.isArray(raw)) throw new Error('Unexpected TeamDynamix locations response');
    return raw.map(item => ({ id: Number(item.ID), name: String(item.Name || '').trim() }))
      .filter(item => Number.isSafeInteger(item.id) && item.id > 0 && item.name)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getRooms(locationId) {
    const raw = await this.request(`/api/locations/${locationId}`);
    const rooms = raw?.Rooms;
    if (!Array.isArray(rooms)) return [];
    return rooms.map(item => ({ id: Number(item.ID), name: String(item.Name || '').trim() }))
      .filter(item => Number.isSafeInteger(item.id) && item.id > 0 && item.name)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  async resolveLocation(locationId, roomId) {
    if (locationId === null) return { location: null, room: null };
    const locations = await this.getLocations();
    const location = locations.find(item => item.id === locationId);
    if (!location) throw new Error('Selected building does not exist');
    const rooms = await this.getRooms(locationId);
    const room = roomId === null ? null : rooms.find(item => item.id === roomId);
    if (roomId !== null && !room) throw new Error('Selected room does not belong to the selected building');
    return { location, room };
  }

  async findAsset(serial) {
    const target = normalizeSerial(serial);
    if (!target) return null;
    if (!this.assetApp) throw new Error('Asset application ID not configured');

    // AssetSearch uses SerialLike, not SerialNumber. Using an unknown field
    // can cause the API to return an unfiltered result set.
    const maxResults = 100;
    const candidates = await this.request(
      `/api/${this.assetApp}/assets/search`,
      'POST',
      { SerialLike: target, MaxResults: maxResults }
    );
    if (!Array.isArray(candidates)) throw new Error('Unexpected asset search response');
    if (candidates.length >= maxResults) {
      throw new Error('SerialLike search hit the result limit; refusing to assume a unique match');
    }

    const possibleIds = new Set();
    for (const candidate of candidates) {
      const candidateId = assetIdOf(candidate);
      if (!Number.isSafeInteger(candidateId) || candidateId <= 0) {
        throw new Error('Asset search returned a candidate without a valid ID');
      }
      // If the search summary includes a serial, we can exclude obvious
      // nonmatches. If it does not, retrieve the asset to confirm.
      if (candidate.SerialNumber != null &&
          normalizeSerial(candidate.SerialNumber) !== target) continue;
      possibleIds.add(candidateId);
    }

    const matches = new Map();
    for (const candidateId of possibleIds) {
      const detail = await this.request(`/api/${this.assetApp}/assets/${candidateId}`);
      if (normalizeSerial(detail?.SerialNumber) === target) {
        matches.set(candidateId, detail);
      }
    }
    console.info(`[Raider Assist] Asset serial lookup: ${candidates.length} candidates, ${matches.size} verified exact matches`);
    if (matches.size > 1) {
      console.warn('[Raider Assist] Duplicate exact asset serials; association skipped');
      return null;
    }
    return matches.size === 1 ? [...matches.values()][0] : null;
  }

  async resolveRequestor(username, requestorType) {
    const suffix = requestorType === 'student' ? '@email.grcc.edu' : '@grcc.edu';
    const email = `${username.toLowerCase()}${suffix}`;
    const raw = await this.request('/api/people/search', 'POST', { SearchText: email, MaxResults: 100 });
    const list = Array.isArray(raw) ? raw : [];
    const matches = list.filter(item => String(item.PrimaryEmail || '').trim().toLowerCase() === email && item.UID);
    const unique = new Map(matches.map(item => [String(item.UID).toLowerCase(), item]));
    return {
      email,
      uid: unique.size === 1 ? String([...unique.values()][0].UID) : null,
      reason: unique.size === 0 ? 'No exact primary email match' : 'Multiple exact matching users'
    };
  }

  async linkAssetToTicket(assetId, ticketId) {
    if (!this.assetApp) throw new Error('Asset application ID not configured');
    // TeamDynamix Assets API: POST /api/{appId}/assets/{id}/tickets/{ticketId}
    return this.request(`/api/${this.assetApp}/assets/${assetId}/tickets/${ticketId}`, 'POST');
  }

  async createTicket(payload, identity) {
    const env = this.env;
    const place = await this.resolveLocation(payload.locationId, payload.roomId);
    const serial = payload.kind === 'computer' ? payload.device.serial : payload.peripheralSerial;

    // Resolve the asset before creating the ticket so redundant device information
    // is omitted when the device already has a unique TeamDynamix asset record.
    let asset = null;
    let assetWarning = '';
    if (serial) {
      try {
        asset = await this.findAsset(serial);
        if (!asset) {
          assetWarning = 'No unique exact serial-number match; ticket created without an asset link.';
        }
      } catch (error) {
        console.error(`[Raider Assist] Asset lookup failed: ${error.message}`);
        assetWarning = 'Ticket created, but automatic asset lookup failed. IT can link the asset manually.';
      }
    }

    const diagnosticRows = [
      ...(payload.device.osBuild ? [['OS build',payload.device.osBuild]] : []),
      ...(Number.isFinite(payload.device.uptimeHours) ? [['System uptime',`${payload.device.uptimeHours} hours`]] : []),
      ...(Number.isFinite(payload.device.diskFreeGB) ? [['Free disk space',`${payload.device.diskFreeGB} GB`]] : []),
      ...(Number.isFinite(payload.device.diskTotalGB) ? [['Total disk space',`${payload.device.diskTotalGB} GB`]] : []),
      ...(payload.device.networkType ? [['Network connection',payload.device.networkType]] : [])
    ];
    const perf = payload.device;
    if(Number.isFinite(perf.cpuUsagePercent)) diagnosticRows.push(['CPU utilization (1-second sample)',roundMetric(perf.cpuUsagePercent,'%')]);
    if(Number.isFinite(perf.memoryUsagePercent)) diagnosticRows.push(['Memory utilization (estimate)',roundMetric(perf.memoryUsagePercent,'%')]);
    if(Number.isFinite(perf.memoryUsedGB)) diagnosticRows.push(['Memory used (estimate)',`${roundMetric(perf.memoryUsedGB)} GB`]);
    if(Number.isFinite(perf.memoryAvailableGB)) diagnosticRows.push(['Free physical memory',`${roundMetric(perf.memoryAvailableGB)} GB`]);
    if(Number.isFinite(perf.memoryTotalGB)) diagnosticRows.push(['Installed memory',`${roundMetric(perf.memoryTotalGB)} GB`]);
    if(Array.isArray(perf.cpuLoadAverage) && perf.cpuLoadAverage.length===3) diagnosticRows.push(['CPU load (1/5/15 minutes)',perf.cpuLoadAverage.join(' / ')]);
    if(perf.performanceSampledAt && !Number.isNaN(Date.parse(perf.performanceSampledAt))) diagnosticRows.push(['Performance sampled (UTC)',new Date(perf.performanceSampledAt).toISOString()]);

    // TeamDynamix in this environment displays Ticket.Description as plain text,
    // so do not submit HTML tags or CSS here.
    const line = (label, value) => `${label}: ${value}`;
    const diagnostics = diagnosticRows.map(([label, value]) => line(label, value));
    // RAIDER_DIAGNOSTICS_FEED_V1
    // Keep the ticket description focused on the issue. All diagnostic readings
    // are added as a private internal feed entry after ticket creation.
    const description = [
      String(payload.description || '').trim(),
      identity.requestorResolution === 'fallback' ? (identity.requestorNote || '') : '',
      `Reported device type: ${payload.kind}`,
      !asset && serial && !payload.includeDiagnostics ? `Reported device serial: ${serial}` : ''
    ].filter(Boolean).join('\n\n');

    const metric = (n, unit = '') => Number.isFinite(n) ? `${Math.round(n * 10) / 10}${unit}` : null;
    const lines = [];
    const put = (name, value) => { if (value != null && value !== '') lines.push(`${name}: ${value}`); };
    if (payload.includeDiagnostics) {
      lines.push('RAIDER ASSIST | DEVICE DIAGNOSTICS', '');
      lines.push('SYSTEM HEALTH');
      put('OS build', perf.osBuild);
      put('System uptime', metric(perf.uptimeHours, ' hours'));
      if (Number.isFinite(perf.diskFreeGB) && Number.isFinite(perf.diskTotalGB)) {
        put('Storage', `${metric(perf.diskFreeGB)} GB free / ${metric(perf.diskTotalGB)} GB total`);
      } else {
        put('Free disk space', metric(perf.diskFreeGB, ' GB'));
        put('Total disk space', metric(perf.diskTotalGB, ' GB'));
      }
      if (!asset) {
        lines.push('', 'DEVICE IDENTIFICATION (ASSET NOT LINKED)');
        put('Computer', perf.hostname || 'Unavailable');
        put('Serial number', perf.serial || serial || 'Unavailable');
        put('Manufacturer', perf.manufacturer);
        put('Model', perf.model);
        put('Operating system', `${perf.os || ''} ${perf.osVersion || ''}`.trim());
        put('CPU model', perf.cpu);
        put('Installed RAM', metric(perf.memoryGB, ' GB'));
      }
      lines.push('', 'CPU PERFORMANCE');
      put('CPU utilization (1-second sample)', metric(perf.cpuUsagePercent, '%'));
      if (Array.isArray(perf.cpuLoadAverage) && perf.cpuLoadAverage.length === 3) {
        put('CPU load (1 / 5 / 15 min)', perf.cpuLoadAverage.map(n => metric(Number(n)) ?? 'N/A').join(' / '));
      }
      const rateLabel = (mbps, kbps) => {
        if (Number.isFinite(kbps)) {
          if (kbps === 0) return '0 Kbps (no traffic detected during sample)';
          return kbps >= 1000 ? `${(kbps / 1000).toFixed(2)} Mbps` : `${kbps.toFixed(1)} Kbps`;
        }
        if (Number.isFinite(mbps)) return mbps === 0 ? '0 Mbps (rounded; very low or idle)' : `${mbps} Mbps`;
        return 'Unavailable';
      };
      lines.push('', 'NETWORK PERFORMANCE');
      put('Connection', perf.networkType || 'Unavailable');
      put('Adapter', perf.networkAdapter || 'Unavailable');
      put('Active interface', perf.networkInterface || 'Unavailable');
      put('Receive rate (1-second sample)', rateLabel(perf.networkReceiveMbps, perf.networkReceiveKbps));
      put('Send rate (1-second sample)', rateLabel(perf.networkSendMbps, perf.networkSendKbps));
      put('Receive errors (cumulative)', Number.isFinite(perf.networkReceiveErrors) ? String(perf.networkReceiveErrors) : 'Unavailable');
      put('Send errors (cumulative)', Number.isFinite(perf.networkSendErrors) ? String(perf.networkSendErrors) : 'Unavailable');
      lines.push('', 'MEMORY PERFORMANCE');
      put('Memory utilization (estimated)', metric(perf.memoryUsagePercent, '%'));
      if (Number.isFinite(perf.memoryUsedGB) && Number.isFinite(perf.memoryTotalGB)) {
        put('Memory', `${metric(perf.memoryUsedGB)} GB used / ${metric(perf.memoryTotalGB)} GB total`);
      } else {
        put('Memory used', metric(perf.memoryUsedGB, ' GB'));
        put('Installed memory', metric(perf.memoryTotalGB, ' GB'));
      }
      put('Free physical memory', metric(perf.memoryAvailableGB, ' GB'));
      if (perf.platform === 'darwin' || perf.os === 'macOS') {
        put('macOS memory pressure', perf.macMemoryPressureLevel || 'Unavailable');
        put('macOS memory availability', metric(perf.macMemoryPressureAvailablePercent, '%') ?? 'Unavailable');
        const swapUsed = metric(perf.macSwapUsedGB, ' GB');
        const swapTotal = metric(perf.macSwapTotalGB, ' GB');
        put('macOS swap usage', swapUsed && swapTotal ? `${swapUsed} used / ${swapTotal} total` : 'Unavailable');
      }

      if (perf.performanceSampledAt && !Number.isNaN(Date.parse(perf.performanceSampledAt))) {
        const when = new Date(perf.performanceSampledAt);
        put('Sample captured', new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Detroit', month: 'short', day: 'numeric', year: 'numeric',
          hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
        }).format(when));
      }
      lines.push('', 'Note: CPU and memory readings are point-in-time estimates. macOS uses memory for reclaimable caches.');
    }
    const diagnosticsFeed = payload.includeDiagnostics ? lines.join('\n') : '';

    const ticket = {
      Title: env.RAIDER_MODE === 'sandbox-test' ? `[RAIDER TEST] ${payload.title}`.slice(0, 160) : payload.title,
      Description: description,
      RequestorUid: identity.tdxUid,
      TypeID: id(env, 'TDX_TYPE_ID'),
      StatusID: id(env, 'TDX_STATUS_ID'),
      PriorityID: id(env, 'TDX_PRIORITY_ID'),
      FormID: id(env, 'TDX_FORM_ID')
    };
    if (env.TDX_ACCOUNT_ID) ticket.AccountID = id(env, 'TDX_ACCOUNT_ID');
    if (place.location) ticket.LocationID = place.location.id;
    if (place.room) ticket.LocationRoomID = place.room.id;

    const created = await this.request(`/api/${this.ticketApp}/tickets`, 'POST', ticket);
    const ticketId = Number(created?.ID ?? created?.TicketID ?? created?.TicketId);
    if (!Number.isSafeInteger(ticketId) || ticketId <= 0) {
      throw new Error('TeamDynamix response did not contain a valid ticket ID');
    }

    let assetLinked = false;
    if (asset) {
      try {
        const assetId = assetIdOf(asset);
        if (!Number.isSafeInteger(assetId) || assetId <= 0) {
          assetWarning = 'Asset match lacked a valid ID; the ticket was created without an asset link.';
        } else {
          await this.linkAssetToTicket(assetId, ticketId);
          assetLinked = true;
        }
      } catch (error) {
        console.error(`[Raider Assist] Asset linking on ticket ${ticketId} failed: ${error.message}`);
        assetWarning = 'Ticket created, but automatic asset linking failed. IT can link the asset manually.';
      }
    }
    let diagnosticsWarning = '';
    if (diagnosticsFeed) {
      try {
        // Do not notify the requestor: internal technician-only diagnostic note.
        await this.request(`/api/${this.ticketApp}/tickets/${ticketId}/feed`, 'POST', {
          Comments: diagnosticsFeed,
          IsPrivate: true,
          Notify: []
        });
      } catch (error) {
        console.error(`[Raider Assist] Diagnostics feed update for ticket ${ticketId} failed: ${error.message}`);
        diagnosticsWarning = 'Ticket created, but the diagnostic feed entry could not be added.';
      }
    }
    const urlBase = env.TDX_TICKET_URL_BASE || '';
    return {
      ticketId,
      assetLinked,
      assetWarning: [assetWarning, diagnosticsWarning].filter(Boolean).join(' '),
      requestorResolution: identity.requestorResolution || 'verified',
      url: urlBase.startsWith('https://supportdesk.grcc.edu/') ? urlBase + ticketId : undefined
    };
  }
}
