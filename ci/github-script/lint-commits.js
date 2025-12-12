// @ts-check
const git = require('isomorphic-git')
const fs = require('fs')
const core = require('@actions/core')
const { spawnSync } = require('node:child_process')

/**
 * @param {{
 *  commitId: string,
 *  reason: string,
 *  postReason: string,
 * }} props
 */
function printError({ commitId, reason, postReason }) {
  return core.error(
    `Commit ${commitId}'s message's subject was detected as not meeting ` +
      `our guidelines because ${reason}. ${postReason}`,
  )
}

/**
 * @param {{
 *   mergedSha: string,
 *   targetSha: string,
 *   path: string
 *   }} props
 */
async function checkCommitMessages({ mergedSha, targetSha, path }) {
  const gitLogProcess = spawnSync(
    'git',
    ['log', '--pretty=format:%H', `${targetSha}..${mergedSha}`],
    {
      encoding: 'utf-8',
      cwd: path,
      shell: false, // Default, but better safe than sorry here, given the potential consequences.
    },
  )

  if (gitLogProcess.error) {
    core.error(
      `An error occurred running "git log ${targetSha}..${mergedSha}".`,
    )
    console.log('Process stdout: ', gitLogProcess.stdout)
    console.log('Process stderr: ', gitLogProcess.stderr)
    return 2
  }

  const commitIds = gitLogProcess.stdout
    .split('\n')
    .map((s) => s.replaceAll('\n', ''))

  let failed = false
  for (const commitId of commitIds) {
    let commitFailed = false

    const commit = await git.readCommit({
      fs,
      oid: commitId,
      dir: path,
    })
    const message = commit.commit.message
    const firstLine = message.slice(0, message.indexOf('\n'))

    if (!firstLine.includes(':')) {
      printError({
        commitId: commit.oid,
        reason: 'does not contain a colon',
        postReason: 'There are likely other issues as well.',
      })
      failed = true
      commitFailed = true
    }

    if (firstLine.endsWith('.')) {
      printError({
        commitId: commit.oid,
        reason: 'ends in a period',
        postReason: 'There may be other issues as well.',
      })
      failed = true
      commitFailed = true
    }

    if (!commitFailed) {
      core.info(`Commit ${commit.oid}'s message's subject seems OK!`)
    }
  }

  if (failed) {
    core.error(
      'Please review the guidelines at ' +
        'https://github.com/NixOS/nixpkgs/blob/master/CONTRIBUTING.md#commit-conventions, ' +
        'as well as the applicable area-specific guidelines linked there.',
    )
    core.setFailed('Commit-linting failed, please see detailed errors above.')
  }
}

module.exports = checkCommitMessages
