/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * This file incorporates work covered by the following copyright and
 * permission notice:
 *
 *   Copyright 2019 Google LLC
 *
 *   Licensed under the Apache License, Version 2.0 (the "License");
 *   you may not use this file except in compliance with the License.
 *   You may obtain a copy of the License at
 *
 *        http://www.apache.org/licenses/LICENSE-2.0
 *
 *   Unless required by applicable law or agreed to in writing, software
 *   distributed under the License is distributed on an "AS IS" BASIS,
 *   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *   See the License for the specific language governing permissions and
 *   limitations under the License.
 */

/*global GamepadManager, Input*/

/*eslint no-unused-vars: ["error", { "vars": "local" }]*/

/**
 * @typedef {Object} WebRTCDemo
 * @property {function} ondebug - Callback fired when new debug message is set.
 * @property {function} onstatus - Callback fired when new status message is set.
 * @property {function} onerror - Callback fired when new error message is set.
 * @property {function} onconnectionstatechange - Callback fired when peer connection state changes.
 * @property {function} ondatachannelclose - Callback fired when data channel is closed.
 * @property {function} ondatachannelopen - Callback fired when data channel is opened.
 * @property {function} onplayvideorequired - Callback fired when user interaction is required before playing video.
 * @property {function} onclipboardcontent - Callback fired when clipboard content from the remote host is received.
 * @property {function} getConnectionStats - Returns promise that resolves with connection stats.
 * @property {Objet} rtcPeerConfig - RTC configuration containing ICE servers and other connection properties.
 * @property {boolean} forceTurn - Force use of TURN server.
 * @property {fucntion} sendDataChannelMessage - Send a message to the peer though the data channel.
 */
class WebRTCDemo {
    /**
     * Interface to WebRTC demo.
     *
     * @constructor
     * @param {WebRTCDemoSignalling} [signalling]
     *    Instance of WebRTCDemoSignalling used to communicate with signalling server.
     * @param {Element} [element]
     *    video element to attach stream to.
     */
    constructor(signalling, element) {
        /**
         * @type {WebRTCDemoSignalling}
         */
        this.signalling = signalling;

        /**
         * @type {Element}
         */
        this.element = element;

        /**
         * @type {boolean}
         */
        this.forceTurn = false;

        /**
         * @type {Object}
         */
        this.rtcPeerConfig = {
            "lifetimeDuration": "86400s",
            "iceServers": [
                {
                    "urls": [
                        "stun:stun.l.google.com:19302"
                    ]
                },
            ],
            "blockStatus": "NOT_BLOCKED",
            "iceTransportPolicy": "all"
        };

        /**
         * @type {RTCPeerConnection}
         */
        this.peerConnection = null;

        /**
         * @type {function}
         */
        this.onstatus = null;

        /**
         * @type {function}
         */
        this.ondebug = null;

        /**
         * @type {function}
         */
        this.onerror = null;

        /**
         * @type {function}
         */
        this.onconnectionstatechange = null;

        /**
         * @type {function}
         */
        this.ondatachannelopen = null;

        /**
         * @type {function}
         */
        this.ondatachannelclose = null;

        /**
         * @type {function}
         */
        this.ongpustats = null;

        /**
         * @type {function}
         */
        this.onlatencymeasurement = null;

        /**
         * @type {function}
         */
        this.onplayvideorequired = null;

        /**
         * @type {function}
         */
        this.onclipboardcontent = null;

        /**
         * @type {function}
         */
        this.onsystemaction = null;

        /**
         * @type {function}
         */
        this.oncursorchange = null;

         /**
          * @type {Map}
          */
        this.cursor_cache = new Map();

        /**
         * @type {function}
         */
        this.onsystemstats = null;

        // Bind signalling server callbacks.
        this.signalling.onsdp = this._onSDP.bind(this);
        this.signalling.onice = this._onSignallingICE.bind(this);
        this.signalling.webrtc_connect =  this._connect.bind(this)
        /**
         * @type {boolean}
         */
        this._connected = false;

        this.localStream = null;
    }

    /**
     * Sets status message.
     *
     * @private
     * @param {String} message
     */
    _setStatus(message) {
        if (this.onstatus !== null) {
            this.onstatus(message);
        }
    }

    /**
     * Sets debug message.
     *
     * @private
     * @param {String} message
     */
    _setDebug(message) {
        if (this.ondebug !== null) {
            this.ondebug(message);
        }
    }

    /**
     * Sets error message.
     *
     * @private
     * @param {String} message
     */
    _setError(message) {
        if (this.onerror !== null) {
            this.onerror(message);
        }
    }

    /**
     * Sets connection state
     * @param {String} state
     */
    _setConnectionState(state) {
        if (this.onconnectionstatechange !== null) {
            this.onconnectionstatechange(state);
        }
    }

    /**
     * Handles incoming ICE candidate from signalling server.
     *
     * @param {RTCIceCandidate} icecandidate
     */
    _onSignallingICE(icecandidate) {
        this._setDebug("received ice candidate from signalling server: " + JSON.stringify(icecandidate));
        if (this.forceTurn && JSON.stringify(icecandidate).indexOf("relay") < 0) { // if no relay address is found, assuming it means no TURN server
            this._setDebug("Rejecting non-relay ICE candidate: " + JSON.stringify(icecandidate));
            return;
        }
        this.peerConnection.addIceCandidate(icecandidate).catch(this._setError);
    }

    /**
     * Handler for ICE candidate received from peer connection.
     * If ice is null, then all candidates have been received.
     *
     * @event
     * @param {RTCPeerConnectionIceEvent} event - The event: https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnectionIceEvent
     */
    _onPeerICE(event) {
        if (event.candidate === null) {
            this._setStatus("Completed ICE candidates from peer connection");
            return;
        }
        this.signalling.sendICE(event.candidate);
    }

    /**
     * Handles incoming SDP from signalling server.
     * Sets the remote description on the peer connection,
     * creates an answer with a local description and sends that to the peer.
     *
     * @param {RTCSessionDescription} sdp
     */
    _onSDP(sdp) {
        console.log("Setting remote SDP")
        this.peerConnection.setRemoteDescription(sdp).then(() => {
            this._setDebug("Remote SDP answer set");
  
        })
    }

    /**
     * Handles local description creation from createAnswer.
     *
     * @param {RTCSessionDescription} local_sdp
     */
    _onLocalSDP(local_sdp) {
        this._setDebug("Created local SDP: " + JSON.stringify(local_sdp));
    }

    getTransceiversStateinfo() {
         // code part to check the icetransports of senders/receivers
         var trport = this.peerConnection.getSenders();
         var iceTransport = trport[0].transport.iceTransport
         iceTransport.onselectedcandidatepairchange = (ev) => {
             let pair = iceTransport.getSelectedCandidatePair();
             console.log("Update candit pair: ", pair)
         };
         console.log("sender iceTransport: ", iceTransport)
         console.log("selected candidate pair: ", trport[0].transport.iceTransport.getSelectedCandidatePair())
         iceTransport.onstatechange = (ev) => {
             console.log("State changed to: ", iceTransport.state);
         }
         console.log("State of ice candidate: ", trport[0].transport.iceTransport.state)
    }

    getSenderParams() {
        const transceiver = this.peerConnection.getTransceivers()[0]
        const sender = transceiver.sender;
        const senderPara = sender.getParameters()
        console.log("Sender Params: ",senderPara)
        console.log("track: ", sender.track)
    }
    /**
     * Handler for peer connection state change.
     * Possible values for state:
     *   connected
     *   disconnected
     *   failed
     *   closed
     * @param {String} state
     */
    _handleConnectionStateChange(state) {
        switch (state) {
            case "connected":
                this._setStatus("Connection complete");
                this._connected = true;
                this.getSenderParams()
                break;

            case "disconnected":
                this._setError("Peer connection disconnected");
                //this.element.load();
                this.getSenderParams();
                break;

            case "failed":
                this._setError("Peer connection failed");
                //this.element.load();
                this.getSenderParams();
                break;
                
            case "closed":
                this._setError("Peer connection closed");
                break;
            default:
        }
    }

    _handleIceConnectionStateChange(state) {
        switch (state) {
            case "checking":
                this._setStatus("Ice connection state: checking");
                break;
            case "connected":
                this._setStatus("Ice connection state: connected");
                break;
            case "completed":
                this._setStatus("Ice connection state: completed");
                break;
            case "disconnected":
                this._setError("Ice connection state: disconnected");
                break;
            case "failed":
                this._setError("Ice connection state: failed");
                break;
            case "closed":
                this._setError("Ice connection state: closed");
                break;
        }
    }

    /**
     * Starts playing the video stream.
     * Note that this must be called after some DOM interaction has already occured.
     * Chrome does not allow auto playing of videos without first having a DOM interaction.
     */
    // [START playVideo]
    playVideo() {
        this.element.load();

        var playPromise = this.element.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                this._setDebug("Video stream is playing.");
            }).catch(() => {
                this._setDebug("Video play failed and no onplayvideorequired was bound.");
            });
        }
    }
    // [END playVideo]

    on_negotiation_needed() {
        console.log("Generating offer: on-negotiation-needed");
        this.peerConnection.createOffer()
            .then(async (local_sdp) => {
                // if (/apt=106/.test(local_sdp.sdp)) {
                //     local_sdp.sdp = local_sdp.sdp.replace(/apt=106/, 'apt=106;rtx-time=125')
                //     console.log(local_sdp.sdp)
                //     console.log("Offer munged");
                // }
                await this.peerConnection.setLocalDescription(local_sdp);
                this._setDebug("Sending SDP offer");
                this.signalling.sendSDP(this.peerConnection.localDescription);
            })
            .catch((err) => {
                this._setError("Error creating local SDP off: ", err);
                console.log(err)
            })
    }


    /**
     * Initiate connection to signalling server.
     */
    _connect() {
        console.log("I'm here bro")
        this.getMedia();

        // Create the peer connection object and bind callbacks.
        this.peerConnection = new RTCPeerConnection(this.rtcPeerConfig);
        this.peerConnection.onicecandidate = this._onPeerICE.bind(this);
        this.peerConnection.onnegotiationneeded = this.on_negotiation_needed.bind(this)
        this.peerConnection.onconnectionstatechange = () => {
            // Local event handling.
            this._handleConnectionStateChange(this.peerConnection.connectionState);

            // Pass state to event listeners.
            this._setConnectionState(this.peerConnection.connectionState);
        };
        
        this.peerConnection.oniceconnectionstatechange = () => {
            this._handleIceConnectionStateChange(this.peerConnection.iceConnectionState);
        }

        if (this.forceTurn) {
            this._setStatus("forcing use of TURN server");
            var config = this.peerConnection.getConfiguration();
            config.iceTransportPolicy = "relay";
            this.peerConnection.setConfiguration(config);
        }
    }

    // async getMedia(){
    //     await navigator.mediaDevices.getUserMedia({
    //         audio: false,
    //         video: true,
    //     })
    //     .then((mediaStream) => {
    //         console.log("Length: ", mediaStream.getTracks().length)
    //         console.log("Track: ", mediaStream.getTracks()[0])
    //         mediaStream.getTracks().forEach((track) => 
    //             this.peerConnection.addTransceiver(track, {
    //                 direction: 'sendonly',
    //                 streams: [mediaStream],
    //             })
    //         );
            

    //         this.localStream = mediaStream;
    //         this.element.srcObject = mediaStream;
    //     })
    //     .catch((err) => {
    //         console.error(`${err.name}: ${err.message}`);
    //       });
    // }

    async getMedia(){
        await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: true,
        })
        .then((mediaStream) => {
            mediaStream.getTracks()
              .forEach(track => {
                console.log("Track: ", track)
                this.peerConnection.addTrack(track, mediaStream)
            })

            this.localStream = mediaStream;
            this.element.srcObject = mediaStream;
        })
        .catch((err) => {
            console.error(`${err.name}: ${err.message}`);
          });
    }

    reset() {
        var signalState = this.peerConnection.signalingState;
        if (this.peerConnection !== null) this.peerConnection.close();
        if (signalState !== "stable") {
            setTimeout(() => {
                this.connect();
            }, 3000);
        } else {
            this._connect();
        }
    }

    async sleep(milliseconds) {
        await new Promise((resolve, reject) => {
            setTimeout(() => {
                resolve();
            }, milliseconds);
        });
    }
}

export default WebRTCDemo