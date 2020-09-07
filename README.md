# GitHub Batch Updater

Script to help make basic additions to multiple GitHub repositories.

Currently this just adds a single file and opens a pull request.

## Usage

Set the environment variable `GITHUB_TOKEN` to your GitHub personal token.

Run `./main.js addfile --help` to see usage information.

For example, this will open a GitHub pull request that adds the local file `README.md` to `dir2/README-2.md` in the `manicstreetpreacher/github-api-test` repository:

    ./main.js addfile README.md --base manicstreetpreacher/github-api-test --dest dir2/README-2.md --branch test-new-ref --title 'This is a test' --body $'This is a test of creating a PR using [octokit rest.js](https://github.com/octokit/rest.js/)\n\n:octocat: :smile: :star:' --force

Note this uses [Bash ANSI C-like escape sequences](http://wiki.bash-hackers.org/syntax/quoting?s[]=ansi&s[]=sequence#ansi_c_like_strings) to pass multiple lines to the body.
