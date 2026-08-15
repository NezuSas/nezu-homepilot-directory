import { generateKeyPairSync } from 'node:crypto';

const keys = generateKeyPairSync('ed25519');
const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
console.log('DIRECTORY_SSO_PRIVATE_KEY=' + JSON.stringify(privateKey));
console.log('DIRECTORY_SSO_PUBLIC_KEY=' + JSON.stringify(publicKey));