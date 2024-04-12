import WebRTCDemoSignalling from './signalling.js'
import WebRTCDemo from './webrtc.js'

// some variables
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');

startButton.addEventListener('click', start);
stopButton.addEventListener('click', stop);

const localVideoElement = document.getElementById('localVideo');
if (localVideoElement === null) {
    throw "localVideoElement not found on page";
  }

localVideoElement.addEventListener('loadedmetadata', function() {
  console.log(`Local video videoWidth: ${this.videoWidth}px,  videoHeight: ${this.videoHeight}px`);
});

var webrtc = null;
var started = false
var signalling = null
function start() {
    started = true;
    startButton.disabled = true;
    var protocol = location.protocol == "http:" ? "ws://" : "wss://";
    signalling = new WebRTCDemoSignalling(
        new URL(
            protocol + "localhost:100" + "/signalling/"
        ),
        1
    );

    webrtc = new WebRTCDemo(signalling, localVideoElement);

    signalling.webrtc_start = webrtc.connect
    // Send signalling status and error messages to logs.
    // signalling.onstatus = (message) => {
    //     console.log("[signalling] " + message);
    // };

    signalling.onerror = (message) => {
        console.log("[signalling] [ERROR] " + message);
    };

    signalling.ondisconnect = () => {
        console.log("signalling disconnected, reconnecting...");
        webrtc.reset();
    };

    signalling.onstatus = (msg) => {
        console.log("[singalling] [status] " + msg)
    }

    // Send webrtc status and error messages to logs.
    webrtc.onstatus = (message) => {
        console.log("[webrtc] [status] " + message);
    };
    webrtc.onerror = (message) => {
        console.log("[webrtc] [ERROR] " + message);
    };


    signalling.ondebug = (message) => {
        console.log("Debug [signalling] " + message);
    }

    webrtc.ondebug = (message) => {
        console.log("Debug [webrtc] " + message);
    }

    // Fetch RTC configuration containing STUN/TURN servers.
    fetch("http://localhost:100/turn/")
      .then(function (response) {
        return response.json();
      })
      .then((config) => {
        // for debugging, force use of relay server.
        webrtc.forceTurn = false;

        if (config.iceServers.length > 1) {
         console.log(config.iceServers[1].urls.join(", "));
        } else {
            console.log("[app] no TURN servers found.");
        }
        webrtc.rtcPeerConfig = config;
        console.log("rtcConfig from server: ", config)
        // webrtc.connect();
        signalling.connect();
    })
    .catch((error) => {
        console.error('Error:', error);
        console.log("server is down!!")   
      });
}

function stop() {
    if (started && webrtc.signalling.state !== "disconnected") {
        // clear video element
        webrtc.element.pause();
        webrtc.element.src = "";
        webrtc.element.srcObject = null;

        console.log("Stopping webrtc connection");
        // console.log("Peer signalling state ", webrtc.peerConnection.signalingState)
        webrtc.peerConnection.close();
        webrtc.signalling.disconnect();

        // release the media sources
        webrtc.localStream.getTracks()
            .forEach(track => {
                track.stop();
            })
    }

    startButton.disabled = false;
}