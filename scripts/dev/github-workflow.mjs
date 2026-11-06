import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { withCleanup } from "./cleanup.mjs";

function validateTarget(repo, number) {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repo) ||
    !Number.isSafeInteger(number) ||
    number < 1
  )
    throw new Error(
      "Expected --repo=owner/name and a positive issue/PR number",
    );
}
function hash(body) {
  return createHash("sha256").update(body).digest("hex");
}
function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}
function writeJson(file, data) {
  const temporary = file + "." + randomUUID() + ".tmp";
  withCleanup(
    () => {
      writeFileSync(temporary, JSON.stringify(data) + "\n", "utf8");
      renameSync(temporary, file);
    },
    () => {
      try {
        unlinkSync(temporary);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    },
  );
}
export function githubJson(args) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 60_000,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      "GitHub read failed; check this environment's gh authentication/permissions before retrying. " +
        (result.error?.message ?? result.stderr.trim()).slice(0, 500),
    );
  return JSON.parse(result.stdout);
}

export function cacheIssue({
  root,
  repo,
  number,
  refresh = false,
  fetchJson = githubJson,
}) {
  validateTarget(repo, number);
  const directory = join(root, ".tools/issues", repo.replace("/", "--"));
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `${number}.json`);
  if (existsSync(file) && !refresh) {
    const cached = readJson(file);
    if (
      cached.repo !== repo ||
      cached.number !== number ||
      cached.url !== `https://github.com/${repo}/issues/${number}` ||
      typeof cached.updatedAt !== "string" ||
      typeof cached.body !== "string" ||
      cached.sha256 !== hash(cached.body)
    )
      throw new Error(
        "Issue cache is invalid; use --refresh to fetch a verified replacement",
      );
    return { ...cached, cached: true };
  }
  const issue = fetchJson(["api", `repos/${repo}/issues/${number}`]);
  if (
    issue.number !== number ||
    issue.html_url !== `https://github.com/${repo}/issues/${number}` ||
    typeof issue.body !== "string" ||
    typeof issue.updated_at !== "string"
  )
    throw new Error(
      "Issue response identity/body/revision is invalid; cache was not replaced",
    );
  const cached = {
    repo,
    number,
    url: issue.html_url,
    updatedAt: issue.updated_at,
    sha256: hash(issue.body),
    body: issue.body,
  };
  writeJson(file, cached);
  return { ...cached, cached: false };
}

export function issueSection(body, title) {
  const lines = body.split("\n");
  let fence = null;
  const headings = lines.flatMap((line, index) => {
    const matchFence = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/.exec(line);
    const delimiter = matchFence?.[1],
      suffix = matchFence?.[2];
    if (fence) {
      if (
        delimiter &&
        delimiter[0] === fence[0] &&
        delimiter.length >= fence.length &&
        /^[ \t\r]*$/.test(suffix)
      )
        fence = null;
      return [];
    }
    if (delimiter && (delimiter[0] === "~" || !suffix.includes("`"))) {
      fence = delimiter;
      return [];
    }
    const match = /^ {0,3}(#{1,6})([ \t][^\r\n]*)?\r?$/.exec(line);
    return match
      ? [
          {
            index,
            level: match[1].length,
            title: (match[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "").trim(),
          },
        ]
      : [];
  });
  if (title === undefined)
    return headings.map((h) => "#".repeat(h.level) + " " + h.title).join("\n");
  const matches = headings.filter((h) => h.title === title);
  if (matches.length !== 1)
    throw new Error("Choose exactly one heading from the cached heading list");
  const start = matches[0],
    end =
      headings.find((h) => h.index > start.index && h.level <= start.level)
        ?.index ?? lines.length;
  return lines.slice(start.index, end).join("\n");
}

const prQuery = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){
  headRefOid state mergeable
  commits(last:1){nodes{commit{statusCheckRollup{contexts(first:100){pageInfo{hasNextPage} nodes{
    __typename ... on CheckRun{name status conclusion detailsUrl} ... on StatusContext{context state targetUrl}
  }}}}}}
  reviews(last:100){pageInfo{hasPreviousPage} nodes{databaseId author{login} state body commit{oid}}}
  comments(last:20){pageInfo{hasPreviousPage} nodes{databaseId author{login} body createdAt updatedAt}}
  reviewThreads(first:100){pageInfo{hasNextPage} nodes{isResolved isOutdated comments(first:100){pageInfo{hasNextPage} nodes{path body author{login}}}}}
}}}`;

export function summarizePullRequest(pr, expectedHead) {
  if (!/^[a-f0-9]{40}$/i.test(expectedHead))
    throw new Error("Expected a full --head SHA");
  if (!pr || pr.headRefOid !== expectedHead)
    throw new Error("PR head changed; inspect the new head before checking it");
  const contexts = pr.commits.nodes[0]?.commit.statusCheckRollup?.contexts;
  const checks = (contexts?.nodes ?? []).map((c) =>
    c.__typename === "CheckRun"
      ? { name: c.name, status: c.status, conclusion: c.conclusion }
      : { name: c.context, status: c.state, conclusion: c.state },
  );
  const truncated =
    !!contexts?.pageInfo.hasNextPage ||
    !!pr.reviews.pageInfo.hasPreviousPage ||
    !!pr.reviewThreads.pageInfo.hasNextPage ||
    pr.reviewThreads.nodes.some(
      (thread) => thread.comments.pageInfo.hasNextPage,
    );
  // This repository's Quality job is required even when unrelated bot checks finish first.
  const requiredChecks = ["windows-quality"];
  const requiredChecksPassed = requiredChecks.every((name) =>
    checks.some(
      (c) =>
        c.name === name &&
        (c.status === "SUCCESS" ||
          (c.status === "COMPLETED" && c.conclusion === "SUCCESS")),
    ),
  );
  return {
    head: expectedHead,
    state: pr.state,
    mergeable: pr.mergeable,
    checks,
    truncated,
    requiredChecks,
    checksPassed:
      !truncated &&
      requiredChecksPassed &&
      checks.every(
        (c) =>
          c.status === "SUCCESS" ||
          (c.status === "COMPLETED" &&
            ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(c.conclusion)),
      ),
    reviews: pr.reviews.nodes.map((r) => ({
      id: r.databaseId,
      author: r.author?.login,
      state: r.state,
      head: r.commit?.oid,
    })),
    comments: pr.comments.nodes.map((c) => ({
      id: c.databaseId,
      author: c.author?.login,
      createdAt: c.createdAt,
    })),
    feedbackRevision: hash(
      JSON.stringify([pr.reviews, pr.comments, pr.reviewThreads]),
    ),
    earlierCommentsOmitted: pr.comments.pageInfo.hasPreviousPage,
    unresolvedThreads: pr.reviewThreads.nodes.filter((t) => !t.isResolved)
      .length,
    reviewDecision:
      "Inspect Codex feedback for this head; comment IDs and zero threads alone do not certify review completion.",
  };
}

export function pullRequestStatus({
  root,
  repo,
  number,
  head,
  details = false,
  fetchJson = githubJson,
}) {
  validateTarget(repo, number);
  if (!/^[a-f0-9]{40}$/i.test(head))
    throw new Error("Expected a full --head SHA");
  const [owner, name] = repo.split("/");
  const data = fetchJson([
    "api",
    "graphql",
    "-f",
    `query=${prQuery}`,
    "-f",
    `owner=${owner}`,
    "-f",
    `name=${name}`,
    "-F",
    `number=${number}`,
  ]);
  if (data.errors?.length)
    throw new Error("GitHub GraphQL response has errors; no status accepted");
  const pr = data.data?.repository?.pullRequest;
  const summary = summarizePullRequest(pr, head);
  const directory = join(root, ".tools/pr-status", repo.replace("/", "--"));
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `${number}.json`);
  const digest = hash(JSON.stringify(summary));
  const previous = existsSync(file) ? readJson(file) : null;
  const changed = previous?.digest !== digest;
  writeJson(file, { digest, head });
  return {
    changed,
    ...(changed || details
      ? summary
      : {
          head,
          checksPassed: summary.checksPassed,
          requiredChecks: summary.requiredChecks,
          unresolvedThreads: summary.unresolvedThreads,
          truncated: summary.truncated,
          earlierCommentsOmitted: summary.earlierCommentsOmitted,
        }),
    ...(details
      ? {
          feedback: {
            reviews: pr.reviews,
            comments: pr.comments,
            threads: pr.reviewThreads,
          },
        }
      : {}),
  };
}

export function main(args) {
  const [command, rawNumber, ...options] = args;
  const values = {};
  for (const option of options) {
    const match = /^--(repo|head|section)=(.+)$/.exec(option);
    const key =
      match?.[1] ??
      (["--refresh", "--details"].includes(option) ? option.slice(2) : null);
    if (!key || Object.hasOwn(values, key))
      throw new Error("Unknown or repeated option");
    values[key] = match ? match[2] : true;
  }
  if (
    !["issue", "pr-status"].includes(command) ||
    !/^\d+$/.test(rawNumber ?? "")
  )
    throw new Error("Expected issue NUMBER or pr-status NUMBER");
  const number = Number(rawNumber),
    repo = values.repo ?? "";
  const root = resolve(".");
  if (command === "issue") {
    if (values.head || values.details)
      throw new Error("Issue options: --repo, --refresh, --section");
    const issue = cacheIssue({ root, repo, number, refresh: values.refresh });
    const { body, ...metadata } = issue;
    console.log(JSON.stringify(metadata));
    console.log(issueSection(body, values.section));
  } else {
    if (values.section || values.refresh)
      throw new Error("PR options: --repo, --head, --details");
    const result = pullRequestStatus({
      root,
      repo,
      number,
      head: values.head,
      details: values.details,
    });
    console.log(JSON.stringify(result));
    if (result.truncated) process.exitCode = 1;
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
