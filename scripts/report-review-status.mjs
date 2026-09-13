#!/usr/bin/env node
import { reportTrustedContributorReview } from './pr-review/status.mjs';

try {
  const result = await reportTrustedContributorReview({
    handoff: {
      schemaVersion: 1,
      pullRequestNumber: Number(process.env.PR_NUMBER),
      baseRepository: process.env.BASE_REPOSITORY,
      baseSha: process.env.BASE_SHA,
      headRepository: process.env.HEAD_REPOSITORY,
      headSha: process.env.HEAD_SHA,
    },
    jobResults: {
      handoff: process.env.HANDOFF_RESULT,
      build: process.env.BUILD_RESULT,
      preview: process.env.PREVIEW_RESULT,
    },
    token: process.env.GITHUB_TOKEN,
    apiUrl: process.env.GITHUB_API_URL,
    detailsUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  });
  console.log(`${result.payload.name}: ${result.conclusion}`);
} catch (error) {
  console.error(`Trusted contributor review reporting failed: ${error.message}`);
  process.exitCode = 1;
}
