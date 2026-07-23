import { randomBytes, scryptSync } from 'node:crypto';
import { createInterface } from 'node:readline';

const readline = createInterface({ input: process.stdin, output: process.stdout });
process.stdout.write('Enter the new AKRD access password: ');
process.stdin.setRawMode?.(true);
let password = '';
process.stdin.on('data', (chunk) => {
  const value = chunk.toString();
  if (value === '\r' || value === '\n') {
    process.stdin.setRawMode?.(false);
    readline.close();
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    process.stdout.write(`\nAdd this line to .env:\nAPP_PASSWORD_HASH=scrypt$${salt}$${hash}\n`);
    return;
  }
  if (value === '\u0003') process.exit(130);
  if (value === '\u007f' || value === '\b') password = password.slice(0, -1);
  else password += value;
});

