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

    const includeDeviceDetails = !asset;
    const deviceDetails = includeDeviceDetails ? [
      `Computer: ${payload.device.hostname || 'Unavailable'}`,
      `Serial: ${payload.device.serial || 'Unavailable'}`,
      `Manufacturer: ${payload.device.manufacturer || 'Unknown'}`,
      `Model: ${payload.device.model || 'Unknown'}`,
      `OS: ${payload.device.os || 'Unknown'} ${payload.device.osVersion || ''}`.trim(),
      `CPU: ${payload.device.cpu || 'Unknown'}`,
      `Memory (GB): ${payload.device.memoryGB ?? 'Unknown'}`
    ].join('\n') : '';

    const description = [
      payload.description,
      identity.requestorResolution === 'fallback' ? (identity.requestorNote || '') : '',
      `Reported device type: ${payload.kind}`,
      // LocationID and LocationRoomID are populated as ticket fields below.
      // Do not repeat building and room in the description.
      !asset && serial && !payload.includeDiagnostics ? `Reported device serial: ${serial}` : '',
      !asset && payload.includeDiagnostics ? `--- Computer diagnostics (asset not linked) ---\n${deviceDetails}` : ''
    ].filter(Boolean).join('\n\n');

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
    const urlBase = env.TDX_TICKET_URL_BASE || '';
    return {
      ticketId,
      assetLinked,
      assetWarning,
      requestorResolution: identity.requestorResolution || 'verified',
      url: urlBase.startsWith('https://supportdesk.grcc.edu/') ? urlBase + ticketId : undefined
    };
  }
}
