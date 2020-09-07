#!/usr/bin/env node
"use strict";

const { Octokit } = require("@octokit/rest");
const { exit, env } = require("process");
const fs = require("fs").promises;

const baseRepo = { owner: "manics", repo: "github-api-test" };
const source = "README.md";
const dest = "dir2/README-2.md";
const title = "This is a test";
const branch = "test-new-ref";
const body = `This is a test of creating a PR using [octokit rest.js](https://github.com/octokit/rest.js/)

:smile: :star:
`;

const token = env["GITHUB_TOKEN"];
if (!token) {
  console.error(
    "ERROR: GITHUB_TOKEN must be provided as an environment variable"
  );
  exit(2);
}

const octokit = new Octokit({ auth: token.trim() });

async function getCurrent(baseRepo) {
  const user = await octokit.users.getAuthenticated();
  const repo = await octokit.repos.get({ ...baseRepo });
  const ref = await octokit.git.getRef({
    ...baseRepo,
    ref: `heads/${repo.data.default_branch}`,
  });
  const commit = await octokit.git.getCommit({
    ...baseRepo,
    commit_sha: ref.data.object.sha,
  });
  const tree = await octokit.git.getTree({
    ...baseRepo,
    tree_sha: commit.data.tree.sha,
  });
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
  try {
    const ref = await octokit.git.updateRef({
      ...headRepo,
      ref: `heads/${branch}`,
      sha: commit.sha,
      force: force,
    });
    console.log(`Updated branch ${ref.data.ref}`);
    return ref.data;
  } catch (err) {
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
  const commit = await createNewFile(current, source, dest);
  const ref = await createOrUpdateRef(current, commit, branch, true);
  const head = `${current.user.login}:${branch}`;

  const currentPull = await octokit.pulls.list({
    ...baseRepo,
    head: head,
  });

  if (currentPull.data) {
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

createPull(baseRepo, branch, source, dest, title, body).then((p) =>
  console.log("Done!")
);
