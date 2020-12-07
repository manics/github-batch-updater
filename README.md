# GitHub Batch Updater

Script to help make basic additions to multiple GitHub repositories.

Currently this just adds or removes files, and opens a pull request against the default branch.

## Installation

Run `npm install` to install dependencies.

## Usage

Set the environment variable `GITHUB_TOKEN` to your GitHub personal token.

Run `./main.js addfile --help` to see usage information.

For example, this will open a GitHub pull request that adds the local file `README.md` to `dir2/README-2.md` and removes `unwanted.txt` in the `manicstreetpreacher/github-api-test` repository:

    ./main.js --base manicstreetpreacher/github-api-test --branch test-new-ref \
    --title 'This is a test' --body $'This is a test of creating a PR using [octokit rest.js](https://github.com/octokit/rest.js/)\n\n:octocat: :smile: :star:' --force \
    --addfile README.md --destfile dir2/README-2.md \
    --rmfile unwanted.txt

Note this uses [Bash ANSI C-like escape sequences](http://wiki.bash-hackers.org/syntax/quoting?s[]=ansi&s[]=sequence#ansi_c_like_strings) to pass multiple lines to the body.

Multiple `--addfile` and `--rmfile` arguments can be passed.
All `--addfile` arguments must have a corresponding `--destfile`.
