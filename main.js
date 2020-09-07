#!/usr/bin/env node
"use strict";

const { Command } = require("commander");
const { Octokit } = require("@octokit/rest");
const { exit, env, argv } = require("process");
const fs = require("fs").promises;

var octokit;

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

async function createNewFile(current, source, dest, message) {
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
    message: message,
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

async function createPull(baseRepo, branch, source, dest, title, body, force) {
  const current = await getCurrent(baseRepo);
  await getOrCreateFork(current);
  const commit = await createNewFile(current, source, dest, body);
  await createOrUpdateRef(current, commit, branch, force);
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

function run(file, cmdObj) {
  const baseSplit = cmdObj.base.split("/");
  if (baseSplit.length != 2) {
    throw Error('base must be in the form "owner/repository"');
  }
  const baseRepo = {
    owner: baseSplit[0],
    repo: baseSplit[1],
  };

  if (cmdObj.args.length != 1) {
    throw Error("One local file path must be given");
  }

  const token = env["GITHUB_TOKEN"];
  if (!token) {
    console.error(
      "ERROR: GITHUB_TOKEN must be provided as an environment variable"
    );
    exit(2);
  }
  octokit = new Octokit({ auth: token.trim() });

  createPull(
    baseRepo,
    cmdObj.branch,
    cmdObj.args[0],
    cmdObj.dest,
    cmdObj.title,
    cmdObj.body,
    cmdObj.force
  ).catch((err) => {
    console.error(err);
    exit(1);
  });
}

const program = new Command();
program
  .command("addfile <file>")
  .description("Add a local file to a repository")
  .requiredOption("--base <base>", "The base repository (head fork)")
  .requiredOption("--dest <dest>", "Destination in the repository for the file")
  .requiredOption("--branch <branch>", "Name of head branch to be created")
  .requiredOption("--title <title>", "Pull request title")
  .option("--body <body>", "Pull request body")
  .option("--force", "Pull request body")
  .action(run);

program.parse(argv);
