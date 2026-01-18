/// @ts-check

// TODO: should this be combined with the branch checks in prepare.js?
// They do seem quite similar, but this needs to run after eval,
// and prepare.js obviously doesn't.

const { classify, split } = require('../supportedBranches.js')
const { readFile } = require('node:fs/promises')
const { postReview, dismissReviews } = require('./reviews.js')

/**
 * @param {{
 *  github: InstanceType<import('@actions/github/lib/utils').GitHub>,
 *  context: import('@actions/github/lib/context').Context
 *  core: import('@actions/core')
 *  dry: boolean
 * }} CheckTargetBranchProps
 */
async function checkTargetBranch({ github, context, core, dry }) {
  const changed = JSON.parse(
    await readFile('comparison/changed-paths.json', 'utf-8'),
  )
  const pull_number = context.payload.pull_request?.number
  if (!pull_number) {
    core.warning(
      'Skipping checkTargetBranch: no pull_request number (is this being run as part of a merge group?)',
    )
    return
  }
  const prInfo = (
    await github.rest.pulls.get({
      ...context.repo,
      pull_number,
    })
  ).data
  const base = prInfo.base.ref
  const head = prInfo.head.ref
  const baseClassification = classify(base)
  const headClassification = classify(head)

  // Don't run on, e.g., staging-nixos to master merges.
  if (headClassification.type.includes('development')) {
    core.info(
      `Skipping checkTargetBranch: PR is from a development branch (${head})`,
    )
    return
  }

  const maxRebuildCount = Math.max(
    ...Object.values(changed.rebuildCountByKernel),
  )
  const rebuildsAllTests = changed.labels['10.rebuild-nixos-tests']

  // TODO: this only requests changes when rebuild count is above 1000, because
  // this is the absolute maximum for master per CONTRIBUTING.md.
  // Should we add a comment when 500 <= maxRebuildCount < 1000? (This would require changes to reviews.js, I believe.)
  if (maxRebuildCount >= 1000 && baseClassification.type.includes('primary')) {
    const desiredBranch =
      base === 'master' ? 'staging' : `staging-${split(base).version}`
    const body = `The PR's base branch is set to \`${base}\`, but this PR causes more than 1000 rebuilds. Please [change the base branch](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/changing-the-base-branch-of-a-pull-request) to [the right base branch for your changes](https://github.com/NixOS/nixpkgs/blob/master/CONTRIBUTING.md#branch-conventions) (probably \`${desiredBranch}\`).`

    await postReview({ github, context, core, dry, body })

    throw new Error('This PR is against the wrong branch.')
  } else if (rebuildsAllTests && baseClassification.type.includes('primary')) {
    const desiredBranch =
      base === 'master' ? 'staging-nixos' : `staging-${split(base).version}`
    const body = `The PR's base branch is set to \`${base}\`, but this PR rebuilds all NixOS tests. Please [change the base branch](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/changing-the-base-branch-of-a-pull-request) to [the right base branch for your changes](https://github.com/NixOS/nixpkgs/blob/master/CONTRIBUTING.md#branch-conventions) (probably \`${desiredBranch}\`).`
    await postReview({ github, context, core, dry, body })

    throw new Error('This PR is against the wrong branch.')
  } else {
    // Any existing reviews were dismissed by commits.js
    core.info('checkTargetBranch: this PR was against an appropriate branch.')
  }
}

module.exports = checkTargetBranch
