var constants = require('constants');
var fs = require('fs');
var request = require('request')

var ssh2 = require('ssh2');
var OPEN_MODE = ssh2.SFTP_OPEN_MODE;
var STATUS_CODE = ssh2.SFTP_STATUS_CODE;

var server = new ssh2.Server({ hostKeys: [fs.readFileSync('host.key')]}, function(client) {
  console.log('Client connected!');

  client.on('authentication', function(ctx) {
    if (ctx.method === 'password'
        && ctx.username === 'foo'
        && ctx.password === 'bar')
      ctx.accept();
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
          if (filename !== '/tmp/foo.txt' || !(flags & OPEN_MODE.WRITE))
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
            uri: 'http://dev.starfighterheavyindustries.com:3000/upload',
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

server.listen(2222, '127.0.0.1', function() {
  console.log('Listening on port ' + this.address().port);
});
