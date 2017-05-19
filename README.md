# Description

SSH2 server that posts files to http endpoint, based on the ssh2 (mscdex/ssh2) module written by Brian White <mscdex@mscdex.net>

[Based on mscdex/ssh2](https://github.com/mscdex/ssh2)

# Getting Started

First, set your HTTP_SERVER_URL environment variable to the URL you would like the file contents posted to.

```
export HTTP_SERVER_URL=http://example.com
```

Clone the repo to your local workspace.

```
git clone git@github.com:jskirst/sftp-to-http.git
```

Inside your project directory, run npm install.

```
npm install
```

Create an SSH key pair. You will use the public key to `sftp` into the server. The private key should be named `host.key` and placed in the root of the project directory.

```
ssh-keygen
```

Start your server:

```
npm run-script run
```

This will start a running server listening on port 2222. To connect to the server:

```
sftp -i [keydirectory]/[keyname].pub -p 2222 foo@localhost
```

To run a basic test, you can put the file `examples/test.txt`.

```
put /[pathtoproject]/examples/test.txt /tmp/foo.txt
```

You should see (something like) the following return:

```
>>>>>>> 0a09ad8... Updating readme
Uploading ./test.txt to /tmp/foo.txt
./test.txt                                                                100%  737     0.7KB/s   00:00
```

And you should see a successful `POST` call made to the HTTP URL you specified in your `package.json`.
