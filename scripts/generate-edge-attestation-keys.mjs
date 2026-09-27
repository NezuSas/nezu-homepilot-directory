import { generateKeyPairSync } from 'node:crypto';

const keys = generateKeyPairSync('ed25519');
console.log('DIRECTORY_EDGE_ATTESTATION_PRIVATE_KEY=' + JSON.stringify(keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()));
console.log('DIRECTORY_EDGE_ATTESTATION_PUBLIC_KEY=' + JSON.stringify(keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()));
