#!/usr/bin/env node
"use strict";

// <<<<< Edit these variables
// The base repository (head fork)
const baseRepo = { owner: "manicstreetpreacher", repo: "github-api-test" };
// Path to the file to be added
const source = "README.md";
// Destination in the repository for the file
const dest = "dir2/README-2.md";
// Head branch, will be overwritten if it already exists
const branch = "test-new-ref";
// Pull request title
const title = "This is a test";
// Pull request body
const body = `This is a test of creating a PR using [octokit rest.js](https://github.com/octokit/rest.js/)

:octocat: :smile: :star:
`;
// >>>>>

const { Octokit } = require("@octokit/rest");
const { exit, env } = require("process");
const fs = require("fs").promises;

const token = env["GITHUB_TOKEN"];
if (!token) {
  console.error(
    "ERROR: GITHUB_TOKEN must be provided as an environment variable"
  );
  exit(2);
}

const octokit = new Octokit({ auth: token.trim() });

async function getCurrent(baseRepo) {
  let user, repo, ref, commit, tree;
  try {
    user = await octokit.users.getAuthenticated();
  } catch (err) {
    throw Error(`Failed to get current user: ${err}`);
  }
  try {
    repo = await octokit.repos.get({ ...baseRepo });
  } catch (err) {
    throw Error(`Failed to get base repo: ${err}`);
  }

  try {
    ref = await octokit.git.getRef({
      ...baseRepo,
      ref: `heads/${repo.data.default_branch}`,
    });
    commit = await octokit.git.getCommit({
      ...baseRepo,
      commit_sha: ref.data.object.sha,
    });
    tree = await octokit.git.getTree({
      ...baseRepo,
      tree_sha: commit.data.tree.sha,
    });
  } catch (err) {
    throw Error(`Failed to get base repo default ref: ${err}`);
  }
  console.log(
    `User: ${user.data.login}, Base repository: ${repo.data.full_name}`
  );
  return {
    user: user.data,
    repo: repo.data,
    ref: ref.data,
    commit: commit.data,
    tree: tree.data,
  };
}

async function getOrCreateFork(current) {
  try {
    const fork = await octokit.repos.get({
      owner: current.user.login,
      repo: current.repo.name,
    });
    return fork;
  } catch (err) {
    if (err.status != 404) {
      throw err;
    }
    const fork = await octokit.repos.createFork({
      owner: current.repo.owner.login,
      repo: current.repo.name,
    });
    console.log("Created fork");
    return fork;
  }
}

async function createNewFile(current, source, dest) {
  const headRepo = {
    owner: current.user.login,
    repo: current.repo.name,
  };

  const content = await fs.readFile(source);
  const blob = await octokit.git.createBlob({
    ...headRepo,
    content: content.toString("base64"),
    encoding: "base64",
  });

  const newtree = await octokit.git.createTree({
    ...headRepo,
    tree: [
      {
        path: dest,
        type: "blob",
        mode: "100644",
        sha: blob.data.sha,
      },
    ],
    base_tree: current.tree.sha,
  });

  const newcommit = await octokit.git.createCommit({
    ...headRepo,
    message: "Test commit",
    tree: newtree.data.sha,
    parents: [current.ref.object.sha],
  });
  console.log(`Created commit ${newcommit.data.sha}`);
  return newcommit.data;
}

async function createOrUpdateRef(current, commit, branch, force) {
  const headRepo = {
    owner: current.user.login,
    repo: current.repo.name,
  };

  // This returns matching prefixes, not exact matches
  const currentRef = await octokit.git.listMatchingRefs({
    ...headRepo,
    ref: `heads/${branch}`,
  });

  if (currentRef.data.some((r) => r.ref === `refs/heads/${branch}`)) {
    const ref = await octokit.git.updateRef({
      ...headRepo,
      ref: `heads/${branch}`,
      sha: commit.sha,
      force: force,
    });
    console.log(`Updated branch ${ref.data.ref}`);
    return ref.data;
  } else {
    const ref = await octokit.git.createRef({
      ...headRepo,
      ref: `refs/heads/${branch}`,
      sha: commit.sha,
    });
    console.log(`Created branch ${ref.data.ref}`);
    return ref.data;
  }
}

async function createPull(baseRepo, branch, source, dest, title, body) {
  const current = await getCurrent(baseRepo);
  await getOrCreateFork(current);
  const commit = await createNewFile(current, source, dest);
  await createOrUpdateRef(current, commit, branch, true);
  const head = `${current.user.login}:${branch}`;

  const currentPull = await octokit.pulls.list({
    ...baseRepo,
    head: head,
  });

  if (currentPull.data.length) {
    const pull = await octokit.pulls.update({
      ...baseRepo,
      title: title,
      pull_number: currentPull.data[0].number,
      base: current.repo.default_branch,
      body: body,
      maintainer_can_modify: true,
    });
    console.log(
      `Updated pull request #${pull.data.number} ${pull.data.html_url}`
    );
    return pull;
  } else {
    const pull = await octokit.pulls.create({
      ...baseRepo,
      title: title,
      head: head,
      base: current.repo.default_branch,
      body: body,
      maintainer_can_modify: true,
    });
    console.log(
      `Created pull request #${pull.data.number} ${pull.data.html_url}`
    );
    return pull;
  }
}

createPull(baseRepo, branch, source, dest, title, body)
  .then(() => console.log("Done!"))
  .catch((err) => {
    console.error(err);
    exit(1);
  });
