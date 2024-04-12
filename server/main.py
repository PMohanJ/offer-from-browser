from signalling import WebRTCSimpleServer

import argparse
import asyncio
import json
import logging
import os
import sys
import time
import urllib.parse
import traceback

from webrtc_signalling import WebRTCSignalling, WebRTCSignallingErrorNoPeer
from gstwebrtc import GSTWebRTCApp

logger = logging.getLogger("main")
logger.setLevel(logging.INFO)

DEFAULT_RTC_CONFIG = """{
  "lifetimeDuration": "86400s",
  "iceServers": [
    {
      "urls": [
        "stun:stun.l.google.com:19302"
      ]
    }
  ],
  "blockStatus": "NOT_BLOCKED",
  "iceTransportPolicy": "all"
}"""

def make_turn_rtc_config_json(host, port, username, password, protocol='udp', tls=False):
    return """{
  "lifetimeDuration": "86400s",
  "iceServers": [
    {
      "urls": [
        "stun:%s:%s"
      ]
    },
    {
      "urls": [
        "%s:%s:%s?transport=%s"
      ],
      "username": "%s",
      "credential": "%s"
    }
  ],
  "blockStatus": "NOT_BLOCKED",
  "iceTransportPolicy": "all"
}""" % (host, port, 'turns' if tls else 'turn', host, port, protocol, username, password)

def parse_rtc_config(data):
    ice_servers = json.loads(data)['iceServers']
    stun_uris = []
    turn_uris = []
    for server in ice_servers:
        for url in server.get("urls", []):
            if url.startswith("stun:"):
                stun_host = url.split(":")[1]
                stun_port = url.split(":")[2].split("?")[0]
                stun_uri = "stun://%s:%s" % (
                    stun_host,
                    stun_port
                )
                stun_uris.append(stun_uri)
            elif url.startswith("turn:"):
                turn_host = url.split(':')[1]
                turn_port = url.split(':')[2].split('?')[0]
                turn_user = server['username']
                turn_password = server['credential']
                turn_uri = "turn://%s:%s@%s:%s" % (
                    urllib.parse.quote(turn_user, safe=""),
                    urllib.parse.quote(turn_password, safe=""),
                    turn_host,
                    turn_port
                )
                turn_uris.append(turn_uri)
            elif url.startswith("turns:"):
                turn_host = url.split(':')[1]
                turn_port = url.split(':')[2].split('?')[0]
                turn_user = server['username']
                turn_password = server['credential']
                turn_uri = "turns://%s:%s@%s:%s" % (
                    urllib.parse.quote(turn_user, safe=""),
                    urllib.parse.quote(turn_password, safe=""),
                    turn_host,
                    turn_port
                )
                turn_uris.append(turn_uri)
    return stun_uris, turn_uris, data

def wait_for_app_ready(ready_file, app_auto_init = True):
    """Wait for streaming app ready signal.

    returns when either app_auto_init is True OR the file at ready_file exists.

    Keyword Arguments:
        app_auto_init {bool} -- skip wait for appready file (default: {True})
    """

    logger.info("Waiting for streaming app ready")
    logging.debug("app_auto_init=%s, ready_file=%s" % (app_auto_init, ready_file))

    while not (app_auto_init or os.path.exists(ready_file)):
        time.sleep(0.2)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--addr',
                        default=os.environ.get(
                            'LISTEN_HOST', '0.0.0.0'),
                        help='Host to listen on for the signaling and web server, default: "0.0.0.0"')
    parser.add_argument('--port',
                        default=os.environ.get(
                            'LISTEN_PORT', '8080'),
                        help='Port to listen on for the signaling and web server, default: "8080"')
    parser.add_argument('--enable_basic_auth',
                        default=os.environ.get(
                            'ENABLE_BASIC_AUTH', 'false'),
                        help='Enable Basic authentication on server. Must set basic_auth_password and optionally basic_auth_user to enforce Basic authentication.')
    parser.add_argument('--basic_auth_user',
                        default=os.environ.get(
                            'BASIC_AUTH_USER', os.environ.get('USER', '')),
                        help='Username for Basic authentication, default is to use the USER environment variable or a blank username if it does not exist. Must also set basic_auth_password to enforce Basic authentication.')
    parser.add_argument('--basic_auth_password',
                        default=os.environ.get(
                            'BASIC_AUTH_PASSWORD', ''),
                        help='Password used when Basic authentication is set.')
    parser.add_argument('--rtc_config_json',
                        default=os.environ.get(
                            'RTC_CONFIG_JSON', '/tmp/rtc.json'),
                        help='JSON file with RTC config to use as alternative to coturn service, read periodically')
    parser.add_argument('--turn_username',
                        default=os.environ.get(
                            'TURN_USERNAME', ''),
                        help='Legacy non-HMAC TURN credential username, also requires TURN_HOST and TURN_PORT.')
    parser.add_argument('--turn_password',
                        default=os.environ.get(
                            'TURN_PASSWORD', ''),
                        help='Legacy non-HMAC TURN credential password, also requires TURN_HOST and TURN_PORT.')
    parser.add_argument('--turn_host',
                        default=os.environ.get(
                            'TURN_HOST', ''),
                        help='TURN host when generating RTC config from shared secret or legacy credentials.')
    parser.add_argument('--turn_port',
                        default=os.environ.get(
                            'TURN_PORT', ''),
                        help='TURN port when generating RTC config from shared secret or legacy credentials.')
    parser.add_argument('--turn_protocol',
                        default=os.environ.get(
                            'TURN_PROTOCOL', 'udp'),
                        help='TURN protocol for the client to use ("udp" or "tcp"), set to "tcp" without the quotes if "udp" is blocked on the network.')
    parser.add_argument('--turn_tls',
                        default=os.environ.get(
                            'TURN_TLS', 'false'),
                        help='Enable or disable TURN over TLS (for the TCP protocol) or TURN over DTLS (for the UDP protocol), valid TURN server certificate required.')
    parser.add_argument('--encoder',
                        default=os.environ.get('WEBRTC_ENCODER', 'x264enc'),
                        help='GStreamer encoder plugin to use')
    parser.add_argument('--app_ready_file',
                        default=os.environ.get('APP_READY_FILE', '/var/run/appconfig/appready'),
                        help='File set by sidecar used to indicate that app is initialized and ready')
    parser.add_argument('--debug', action='store_true',
                        help='Enable debug logging')
    args = parser.parse_args()

    logging.warn(args)

    # Set log level
    if args.debug:
        logging.basicConfig(level=logging.DEBUG)
    else:
        logging.basicConfig(level=logging.INFO)

    # Peer id for this app, default is 0, expecting remote peer id to be 1
    my_id = 0
    peer_id = 1

    # Initialize the signalling client
    signalling = WebRTCSignalling('ws://127.0.0.1:%s/ws' % args.port, my_id, peer_id,
        enable_basic_auth=args.enable_basic_auth.lower() == 'true',
        basic_auth_user=args.basic_auth_user,
        basic_auth_password=args.basic_auth_password)

    # Handle errors from the signalling server.
    async def on_signalling_error(e):
       if isinstance(e, WebRTCSignallingErrorNoPeer):
           # Waiting for peer to connect, retry in 2 seconds.
           time.sleep(2)
           await signalling.setup_call()
       else:
           logger.error("signalling error: %s", str(e))
           app.stop_pipeline()
    signalling.on_error = on_signalling_error

    signalling.on_disconnect = lambda: app.stop_pipeline()

    # After connecting, attempt to setup call to peer.
    signalling.on_connect = signalling.setup_call

    # [START main_setup]
    # Fetch the TURN server and credentials
    rtc_config = None
    turn_protocol = 'tcp' if args.turn_protocol.lower() == 'tcp' else 'udp'
    using_turn_tls = args.turn_tls.lower() == 'true'

    if args.turn_username and args.turn_password:
        if not (args.turn_host and args.turn_port):
            logger.error("missing turn host and turn port")
            sys.exit(1)
        logger.warning("using legacy non-HMAC TURN credentials.")
        config_json = make_turn_rtc_config_json(args.turn_host, args.turn_port, args.turn_username, args.turn_password, turn_protocol, using_turn_tls)
        stun_servers, turn_servers, rtc_config = parse_rtc_config(config_json)

    logger.info("initial server RTC config: {}".format(rtc_config))

     # Create instance of app
    app = GSTWebRTCApp(stun_servers, turn_servers, args.encoder)

    # [END main_setup]

    # Send the local sdp to signalling when offer is generated.
    app.on_sdp = signalling.send_sdp

    # Send ICE candidates to the signalling server.
    app.on_ice = signalling.send_ice

    # Set the remote SDP when received from signalling server.
    signalling.on_sdp = app.set_sdp

    # Set ICE candidates received from signalling server.
    signalling.on_ice = app.set_ice

    # Start the pipeline once the session is established.
    signalling.on_session = app.start_pipeline

    # [START main_start]
    # Connect to the signalling server and process messages.
    loop = asyncio.get_event_loop()

    # Initialize the signaling and web server
    options = argparse.Namespace()
    options.addr = args.addr
    options.port = args.port
    options.enable_basic_auth = args.enable_basic_auth
    options.basic_auth_user = args.basic_auth_user
    options.basic_auth_password = args.basic_auth_password
    options.disable_ssl = True
    options.health = "/health"
    options.keepalive_timeout = 30
    options.cert_path = None
    options.cert_restart = False
    options.rtc_config_file = args.rtc_config_json
    options.rtc_config = rtc_config
    options.turn_host = args.turn_host
    options.turn_port = args.turn_port
    options.turn_protocol = turn_protocol
    options.turn_tls = using_turn_tls
    server = WebRTCSimpleServer(loop, options)

    try:
        server.run()

        while True:
            asyncio.ensure_future(app.handle_bus_calls(), loop=loop)

            asyncio.ensure_future(app.check_property(), loop=loop)
            
            loop.run_until_complete(signalling.connect())
            loop.run_until_complete(signalling.start())
            
            app.stop_pipeline()
    except Exception as e:
        logger.error("Caught exception: %s" % e)
        traceback.print_exc()
        sys.exit(1)
    finally:
        server.server.close()
        sys.exit(0)
    # [END main_start]

if __name__ == '__main__':
    main()