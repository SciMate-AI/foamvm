import fs from 'node:fs'
import { Sandbox } from 'e2b'

function loadEnv(path) {
  const text = fs.readFileSync(path, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/)
    if (match) process.env[match[1]] = match[2]
  }
}

async function runCommand(sandbox, command, timeoutMs = 120000) {
  const openfoamEnv = 'for f in /opt/openfoam*/etc/bashrc /usr/lib/openfoam/openfoam*/etc/bashrc; do [ -f "$f" ] && . "$f" && break; done'
  const shellQuote = (value) => `'${value.replace(/'/g, `'\\''`)}'`
  const fullCommand = `bash -o pipefail -lc ${shellQuote(`${openfoamEnv}; ${command}`)}`
  console.log(`\n$ ${command}`)
  try {
    const result = await sandbox.commands.run(fullCommand, {
      cwd: '/workspace/case',
      timeoutMs,
    })
    if (result.stdout) console.log(result.stdout.slice(-3000))
    if (result.stderr) console.error(result.stderr.slice(-1500))
    return result
  } catch (error) {
    console.log(`exit=${error.exitCode ?? 'unknown'}`)
    if (error.stdout) console.log(error.stdout.slice(-3000))
    if (error.stderr) console.error(error.stderr.slice(-3000))
    throw error
  }
}

async function main() {
  loadEnv('D:/foamvm/.env.local')
  const manifestPath = 'D:/javascript/cae-agent/physicsOS/scratch/problem_openfoam-smoke/solver_fallback/openfoam/openfoam_runner_manifest.json'
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  console.log(`template=${process.env.E2B_TEMPLATE_ID}`)
  console.log(`manifest=${manifestPath}`)

  const sandbox = await Sandbox.create(process.env.E2B_TEMPLATE_ID, {
    apiKey: process.env.E2B_API_KEY,
    timeoutMs: 10 * 60 * 1000,
  })

  try {
    await sandbox.commands.run('rm -rf /workspace/case /workspace/output && mkdir -p /workspace/case /workspace/output', { timeoutMs: 10000 })
    for (const file of manifest.openfoam.case_files) {
      const target = `/workspace/case/${file.path}`
      const dir = target.split('/').slice(0, -1).join('/')
      await sandbox.commands.run(`mkdir -p ${JSON.stringify(dir)}`, { timeoutMs: 10000 })
      await sandbox.files.write(target, file.content)
    }

    const solver = manifest.openfoam.solver || manifest.backend_command || 'simpleFoam'
    await runCommand(sandbox, 'command -v blockMesh; command -v simpleFoam; command -v foamToVTK; foamVersion || true', 60000)
    await runCommand(sandbox, 'blockMesh | tee /workspace/output/log.blockMesh', 120000)
    await runCommand(sandbox, `${solver} | tee /workspace/output/log.${solver}`, 300000)
    await runCommand(sandbox, 'find . -maxdepth 1 -type d | sort | tee /workspace/output/time-directories.txt && find . -maxdepth 1 -type d ! -name . ! -name 0 | grep -Eq "^./[0-9]"', 60000)
    await runCommand(sandbox, 'foamToVTK | tee /workspace/output/log.foamToVTK', 180000)
    await runCommand(sandbox, '[ -d VTK ] && tar -czf /workspace/output/VTK.tar.gz VTK && ls -lh /workspace/output/VTK.tar.gz', 60000)
    const outputs = await sandbox.commands.run('find /workspace/output -maxdepth 1 -type f -printf "%f %s\\n" | sort', { timeoutMs: 10000 })
    console.log(`\noutputs\n${outputs.stdout}`)
  } finally {
    await sandbox.kill().catch(() => {})
  }
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exit(1)
})
