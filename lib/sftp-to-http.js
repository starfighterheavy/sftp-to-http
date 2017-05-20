var constants = require('constants');
var fs = require('fs');
var request = require('request')
var ssh2 = require('ssh2');
var crypto = require('crypto');
var inspect = require('util').inspect;
var buffersEqual = require('buffer-equal-constant-time');
var utils = ssh2.utils;

var OPEN_MODE = ssh2.SFTP_OPEN_MODE;
var STATUS_CODE = ssh2.SFTP_STATUS_CODE;
var HTTP_SERVER_URL = process.env.HTTP_SERVER_URL
var SFTP_SERVER_PORT = process.env.SFTP_SERVER_PORT
var SFTP_SERVER_KEY_PATH = process.env.SFTP_SERVER_KEY_PATH

var pubKey = utils.genPublicKey(utils.parseKey(fs.readFileSync(SFTP_SERVER_KEY_PATH)));

var server = new ssh2.Server({ hostKeys: [fs.readFileSync('host.key')]}, function(client) {
  console.log('Client connected!');

  client.on('authentication', function(ctx) {
    console.log('Attempting to authenticate...')
    if (ctx.method === 'publickey'
             && ctx.key.algo === pubKey.fulltype
             && buffersEqual(ctx.key.data, pubKey.public)) {
      console.log('Publickey authentication attempt')
      if (ctx.signature) {
        var verifier = crypto.createVerify(ctx.sigAlgo);
        verifier.update(ctx.blob);
        if (verifier.verify(pubKey.publicOrig, ctx.signature))
          ctx.accept();
        else
          ctx.reject();
      } else {
        // if no signature present, that means the client is just checking
        // the validity of the given public key
        ctx.accept();
      }
    }
    else
      ctx.reject();
  }).on('ready', function() {
    console.log('Client authenticated!');

    client.on('session', function(accept, reject) {
      var session = accept();
      session.on('sftp', function(accept, reject) {
        console.log('Client SFTP session');
        var openFiles = {};
        var handleCount = 0;
        console.log('Accepting stream')
        var sftpStream = accept();

        sftpStream.on('OPEN', function(reqid, filename, flags, attrs) {
          console.log('Attempting to open')
          // only allow opening /tmp/foo.txt for writing
          if (!(flags & OPEN_MODE.WRITE))
            return sftpStream.status(reqid, STATUS_CODE.FAILURE);
          // create a fake handle to return to the client, this could easily
          // be a real file descriptor number for example if actually opening
          // the file on the disk
          var handle = new Buffer(4);
          openFiles[handleCount] = true;
          handle.writeUInt32BE(handleCount++, 0, true);
          sftpStream.handle(reqid, handle);
          console.log('Opening file for write')
        });

        sftpStream.on('READ', function(reqid, handle, offset, length) {
          if (handle.length !== 4 || !openFiles[handle.readUInt32BE(0, true)])
            return sftpStream.status(reqid, STATUS_CODE.FAILURE);
          // fake the read
          var state = openFiles[handle.readUInt32BE(0, true)];
          if (state.read)
            sftpStream.status(reqid, STATUS_CODE.EOF);
          else {
            state.read = true;
            sftpStream.data(reqid, 'bar');
            console.log('Read from file at offset %d, length %d', offset, length);
          }
        });

        sftpStream.on('REALPATH', function(reqid, path) {
          var name = [{
            filename: '/tmp/foo.txt',
            longname: '-rwxrwxrwx 1 foo foo 3 Dec 8 2009 foo.txt',
            attrs: {}
          }];
          sftpStream.name(reqid, name);
        });

        sftpStream.on('WRITE', function(reqid, handle, offset, data) {
          if (handle.length !== 4 || !openFiles[handle.readUInt32BE(0, true)])
            return sftpStream.status(reqid, STATUS_CODE.FAILURE);
          postData(data)
          // fake the write
          sftpStream.status(reqid, STATUS_CODE.OK);
          var inspected = require('util').inspect(data);
        });

        sftpStream.on('CLOSE', function(reqid, handle) {
          var fnum;
          if (handle.length !== 4 || !openFiles[(fnum = handle.readUInt32BE(0, true))])
            return sftpStream.status(reqid, STATUS_CODE.FAILURE);
          delete openFiles[fnum];
          sftpStream.status(reqid, STATUS_CODE.OK);
          console.log('Closing file');
        });

        sftpStream.on('STAT', onSTAT)

        sftpStream.on('LSTAT', onSTAT);

        function postData(data){
          request({
            method: 'POST',
            preambleCRLF: true,
            postambleCRLF: true,
            uri: HTTP_SERVER_URL,
            multipart: [
              {
                'content-type': 'text/plain',
                body: data
              }
            ]
          }, function (error, response, body) {
            if (error) {
              return console.error('upload failed:', error);
            }
            console.log('Upload successful!  Server responded with:', body);
          });
        }

        function onSTAT(reqid, path) {
          if (path !== '/tmp/foo.txt')
            return sftpStream.status(reqid, STATUS_CODE.FAILURE);

          var mode = constants.S_IFREG; // Regular file
          mode |= constants.S_IRWXU; // read, write, execute for user
          mode |= constants.S_IRWXG; // read, write, execute for group
          mode |= constants.S_IRWXO; // read, write, execute for other

          sftpStream.attrs(reqid, {
            mode: mode,
            uid: 0,
            gid: 0,
            size: 3,
            atime: Date.now(),
            mtime: Date.now()
          });
        }
        ;
      });
    });
  })

  client.on('end', function() {
    console.log('Client disconnected');
  });
});

server.listen(SFTP_SERVER_PORT, '127.0.0.1', function() {
  console.log('Listening on port ' + this.address().port);
});
