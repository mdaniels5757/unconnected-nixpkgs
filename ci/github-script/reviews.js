// @ts-check

const eventToState = {
  COMMENT: 'COMMENTED',
  REQUEST_CHANGES: 'CHANGES_REQUESTED',
}

/**
 * @param {{
 *  github: InstanceType<import('@actions/github/lib/utils').GitHub>,
 *  context: import('@actions/github/lib/context').Context,
 *  core: import('@actions/core'),
 *  dry: boolean,
 *  reviewKey?: string,
 * }} DismissReviewsProps
 */
async function dismissReviews({ github, context, core, dry, reviewKey }) {
  const pull_number = context.payload.pull_request?.number
  if (!pull_number) {
    core.warning('dismissReviews called outside of pull_request context')
    return
  }

  if (dry) {
    return
  }

  const reviews = (
    await github.paginate(github.rest.pulls.listReviews, {
      ...context.repo,
      pull_number,
    })
  ).filter((review) => review.user?.login === 'github-actions[bot]')

  /** @type {(review: { body: string } ) => boolean} */
  let reviewFilter
  const reviewKeyRegex = new RegExp(/<!-- nixpkgs review key: (.*) -->/)

  // If every review has a review key comment, then we can only dismiss
  // the appropriate review. If at least one does not have a review key comment,
  // or if the reviewKey parameter is not provided, we must dismiss all of them.
  if (
    reviewKey &&
    reviews.every((review) => reviewKeyRegex.test(review.body))
  ) {
    reviewFilter = (review) =>
      review.body.includes(`<!-- nixpkgs review key: ${reviewKey} -->`)
  } else {
    reviewFilter = (_) => true
  }

  await Promise.all(
    reviews.filter(reviewFilter).map(async (review) => {
      if (review.state === 'CHANGES_REQUESTED') {
        await github.rest.pulls.dismissReview({
          ...context.repo,
          pull_number,
          review_id: review.id,
          message: 'Review dismissed automatically',
        })
      }
      await github.graphql(
        `mutation($node_id:ID!) {
              minimizeComment(input: {
                classifier: OUTDATED,
                subjectId: $node_id
              })
              { clientMutationId }
            }`,
        { node_id: review.node_id },
      )
    }),
  )
}

/**
 * @param {{
 *  github: InstanceType<import('@actions/github/lib/utils').GitHub>,
 *  context: import('@actions/github/lib/context').Context
 *  core: import('@actions/core'),
 *  dry: boolean,
 *  body: string,
 *  event: keyof eventToState,
 *  reviewKey?: string,
 * }} PostReviewProps
 */
async function postReview({
  github,
  context,
  core,
  dry,
  body,
  event = 'REQUEST_CHANGES',
  reviewKey,
}) {
  const pull_number = context.payload.pull_request?.number
  if (!pull_number) {
    core.warning('postReview called outside of pull_request context')
    return
  }

  const pendingReview = (
    await github.paginate(github.rest.pulls.listReviews, {
      ...context.repo,
      pull_number,
    })
  ).find(
    (review) =>
      review.user?.login === 'github-actions[bot]' &&
      review.state === eventToState[event],
  )

  if (reviewKey) {
    body = body + `\n\n<!-- nixpkgs review key: ${reviewKey} -->`
  }

  if (dry) {
    if (pendingReview)
      core.info(`pending review found: ${pendingReview.html_url}`)
    else core.info('no pending review found')
    core.info(body)
  } else {
    if (pendingReview) {
      await github.rest.pulls.updateReview({
        ...context.repo,
        pull_number,
        review_id: pendingReview.id,
        body,
      })
    } else {
      await github.rest.pulls.createReview({
        ...context.repo,
        pull_number,
        event,
        body,
      })
    }
  }
}

module.exports = {
  dismissReviews,
  postReview,
}
