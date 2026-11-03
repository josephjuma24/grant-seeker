import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose';

// Prints a fresh Ed25519 key pair as .env lines (PEM newlines escaped).
// Usage: npm run keys >> .env
const { privateKey, publicKey } = await generateKeyPair('EdDSA', {
  crv: 'Ed25519',
  extractable: true,
});

const oneLine = (pem: string) => pem.trim().replace(/\n/g, '\\n');

console.log(`JWT_PRIVATE_KEY="${oneLine(await exportPKCS8(privateKey))}"`);
console.log(`JWT_PUBLIC_KEY="${oneLine(await exportSPKI(publicKey))}"`);
console.log(`JWT_KEY_ID="gs-ed25519-${new Date().toISOString().slice(0, 10)}"`);
