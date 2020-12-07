#!/usr/bin/env node
"use strict";

const { Command } = require("commander");
const { Octokit } = require("@octokit/rest");
const { Buffer } = require("buffer");
const { exit, env, argv } = require("process");
const { promisify } = require("util");
const { readFile } = require("fs");

var octokit;

async function getCurrent(baseRepo) {
  try {
    var { data: user } = await octokit.users.getAuthenticated();
  } catch (err) {
    throw Error(`Failed to get current user: ${err}`);
  }
  try {
    var { data: repo } = await octokit.repos.get({ ...baseRepo });
  } catch (err) {
    throw Error(`Failed to get base repo: ${err}`);
  }

  try {
    var { data: ref } = await octokit.git.getRef({
      ...baseRepo,
      ref: `heads/${repo.default_branch}`,
    });
    var { data: commit } = await octokit.git.getCommit({
      ...baseRepo,
      commit_sha: ref.object.sha,
    });
    var { data: tree } = await octokit.git.getTree({
      ...baseRepo,
      tree_sha: commit.tree.sha,
    });
  } catch (err) {
    throw Error(`Failed to get base repo default ref: ${err}`);
  }
  console.log(`User: ${user.login}, Base repository: ${repo.full_name}`);
  return {
    user: user,
    repo: repo,
    ref: ref,
    commit: commit,
    tree: tree,
  };
}

async function getOrCreateFork(current) {
  try {
    const { data: fork } = await octokit.repos.get({
      owner: current.user.login,
      repo: current.repo.name,
    });
    return fork;
  } catch (err) {
    if (err.status != 404) {
      throw err;
    }
    const { data: fork } = await octokit.repos.createFork({
      owner: current.repo.owner.login,
      repo: current.repo.name,
    });
    console.log("Created fork");
    return fork;
  }
}

async function getCurrentFile(current, path) {
  try {
    const { data: currentFile } = await octokit.repos.getContent({
      owner: current.repo.owner.login,
      repo: current.repo.name,
      ref: current.repo.default_branch,
      path: path,
    });
    const buffer = Buffer.from(currentFile.content, currentFile.encoding);
    return buffer;
  } catch (err) {
    if (err.status == 404) {
      return null;
    }
    throw err;
  }
}

async function updateFiles(current, addfiles, destfiles, rmfiles, message) {
  const headRepo = {
    owner: current.user.login,
    repo: current.repo.name,
  };

  let blobs = []
  for (let i = 0; i < addfiles.length; i++) {
    const dest = destfiles[i];
    const content = await promisify(readFile)(addfiles[i]);
    const currentFile = await getCurrentFile(current, dest);
    // console.log(`source: ${content}`)
    // console.log(`currentFile: ${currentFile}`)

    if (currentFile && content.equals(currentFile)) {
      console.log(
        `${current.repo.full_name}/${current.repo.default_branch} ${dest} is already up to date`
      );
      continue;
    }

    // const { data: blob } = await octokit.git.createBlob({
    //   ...headRepo,
    //   content: content.toString("base64"),
    //   encoding: "base64",
    // });
    blobs.push({
      path: dest,
      type: "blob",
      mode: "100644",
      // sha: blob.sha,
      content: content.toString(),
    });
  }

  for (let i = 0; i < rmfiles.length; i++) {
    const rm = rmfiles[i]
    const currentFile = await getCurrentFile(current, rm);
    if (currentFile) {
      blobs.push({
        path: rm,
        type: "blob",
        mode: "100644",
        sha: null,
      });
    }
  }

  if (!blobs.length) {
    console.log(
      `${current.repo.full_name}/${current.repo.default_branch} is already up to date`
    );
    return;
  }

  const { data: newtree } = await octokit.git.createTree({
    ...headRepo,
    tree: blobs,
    base_tree: current.tree.sha,
  });

  const { data: newcommit } = await octokit.git.createCommit({
    ...headRepo,
    message: message,
    tree: newtree.sha,
    parents: [current.ref.object.sha],
  });
  console.log(`Created commit ${newcommit.sha}`);
  return newcommit;
}

async function createOrUpdateRef(current, commit, branch, force) {
  const headRepo = {
    owner: current.user.login,
    repo: current.repo.name,
  };

  // This returns matching prefixes, not exact matches
  const { data: currentRef } = await octokit.git.listMatchingRefs({
    ...headRepo,
    ref: `heads/${branch}`,
  });

  if (currentRef.some((r) => r.ref === `refs/heads/${branch}`)) {
    const { data: ref } = await octokit.git.updateRef({
      ...headRepo,
      ref: `heads/${branch}`,
      sha: commit.sha,
      force: force,
    });
    console.log(`Updated branch ${ref.ref}`);
    return ref;
  } else {
    const { data: ref } = await octokit.git.createRef({
      ...headRepo,
      ref: `refs/heads/${branch}`,
      sha: commit.sha,
    });
    console.log(`Created branch ${ref.ref}`);
    return ref;
  }
}

async function createPull(baseRepo, branch, addfiles, destfiles, rmfiles, title, body, force) {
  const current = await getCurrent(baseRepo);

  await getOrCreateFork(current);
  const commit = await updateFiles(current, addfiles, destfiles, rmfiles, body);

  if (!commit) {
    return;
  }

  await createOrUpdateRef(current, commit, branch, force);
  const head = `${current.user.login}:${branch}`;

  const { data: currentPull } = await octokit.pulls.list({
    ...baseRepo,
    head: head,
  });

  if (currentPull.length) {
    const { data: pull } = await octokit.pulls.update({
      ...baseRepo,
      title: title,
      pull_number: currentPull[0].number,
      base: current.repo.default_branch,
      body: body,
      maintainer_can_modify: true,
    });
    console.log(`Updated pull request #${pull.number} ${pull.html_url}`);
    return pull;
  } else {
    const { data: pull } = await octokit.pulls.create({
      ...baseRepo,
      title: title,
      head: head,
      base: current.repo.default_branch,
      body: body,
      maintainer_can_modify: true,
    });
    console.log(`Created pull request #${pull.number} ${pull.html_url}`);
    return pull;
  }
}

function run(cmdObj) {
  const baseSplit = cmdObj.base.split("/");
  if (baseSplit.length != 2) {
    throw Error('base must be in the form "owner/repository"');
  }
  if (cmdObj.addfile.length != cmdObj.destfile.length) {
    throw Error(`Received ${cmdObj.addfile.length} files to add but ${cmdObj.destfile.length} destinations`);
  }
  const baseRepo = {
    owner: baseSplit[0],
    repo: baseSplit[1],
  };

  if (!cmdObj.addfile.length && !cmdObj.rmfile.length) {
    throw Error("At least one addfile or rmfile required");
  }

  const token = env["GITHUB_TOKEN"];
  if (!token) {
    console.error(
      "ERROR: GITHUB_TOKEN must be provided as an environment variable"
    );
    exit(2);
  }
  octokit = new Octokit({
    auth: token.trim(),
    userAgent: "github-batch-updater",
  });

  createPull(
    baseRepo,
    cmdObj.branch,
    cmdObj.addfile,
    cmdObj.destfile,
    cmdObj.rmfile,
    cmdObj.title,
    cmdObj.body,
    cmdObj.force
  ).catch((err) => {
    console.error(err);
    exit(1);
  });
}

function collect(value, previous) {
  return previous.concat([value]);
}

const program = new Command();
program
  .version('0.0.1')
  .requiredOption("--base <base>", "The base repository (head fork)")
  .requiredOption("--branch <branch>", "Name of head branch to be created")
  .requiredOption("--title <title>", "Pull request title")
  .option("--body <body>", "Pull request body")
  .option("--force", "Pull request body")
  .option("--addfile <file>", "Add local files to a repository", collect, [])
  .option("--destfile <file>", "Destination in the repository for added files", collect, [])
  .option("--rmfile <file>", "Remove files from a repository", collect, [])
  .action(run);

program.parse(argv);
