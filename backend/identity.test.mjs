import test from 'node:test';import assert from 'node:assert/strict';import {resolveIdentity} from './identity.mjs';
test('demo never asserts a user identity',()=>assert.equal(resolveIdentity({headers:{'x-grcc-authenticated-tdx-uid':'fake'}},{RAIDER_MODE:'demo'}),null));
test('production refuses missing trusted proxy configuration',()=>assert.throws(()=>resolveIdentity({headers:{}},{RAIDER_MODE:'production'})));
test('trusted proxy mode requires asserted identity',()=>assert.equal(resolveIdentity({headers:{}},{RAIDER_MODE:'production',IDENTITY_INTEGRATION:'trusted-proxy',TRUSTED_PROXY_ENABLED:'true'}),null));
