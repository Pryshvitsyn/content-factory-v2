'use strict';

function argumentsFrom(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]; const value = argv[index + 1];
    if (!key?.startsWith('--') || value == null) throw new Error('Arguments must be --name value pairs');
    result[key.slice(2)] = value;
  }
  return result;
}

async function main() {
  const args = argumentsFrom(process.argv.slice(2));
  for (const required of ['avatar-id','brand-id','kind']) if (!args[required]) throw new Error(`--${required} is required`);
  const base = args['api-base'] || 'http://127.0.0.1:3001';
  const payload = { brandId: args['brand-id'], kind: String(args.kind).toUpperCase(),
    ...(args['source-asset-id'] ? { sourceAssetId: args['source-asset-id'] } : {}),
    ...(args['generation-spec-id'] ? { generationSpecId: args['generation-spec-id'] } : {}),
    ...(args['execution-id'] ? { executionId: args['execution-id'] } : {}) };
  const response = await fetch(`${base}/api/avatar-studio/avatars/${encodeURIComponent(args['avatar-id'])}/smoke-readiness`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${result?.error?.code || response.status}: ${result?.error?.message || 'Readiness request failed'}`);
  process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
  if (!result.ready) process.exitCode = 2;
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
