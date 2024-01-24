import React, { useEffect, useState, useRef } from 'react';
import './App.css';
import io from "socket.io-client";
import Peer from "simple-peer";
import styled from "styled-components";

const Container = styled.div`
    height: 100vh;
    width: 100%;
    display: flex;
    flex-direction: column;
`;

const Row = styled.div`
    display: flex;
    width: 100%;
`;

const Video = styled.video`
    border: 1px solid blue;
    width: 50%;
    height: 50%;
`;

function App() {
    const [yourID, setYourID] = useState("");
    const [users, setUsers] = useState({});
    const [stream, setStream] = useState();
    const [receivingCall, setReceivingCall] = useState(false);
    const [caller, setCaller] = useState("");
    const [callerSignal, setCallerSignal] = useState();
    const [callAccepted, setCallAccepted] = useState(false);

    const userVideo = useRef();
    const partnerVideo = useRef();
    const socket = useRef();
    const peerRef = useRef(); // Ref for peer instance

    useEffect(() => {
        socket.current = io.connect("/");
        navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(stream => {
            setStream(stream);
            if (userVideo.current) {
                userVideo.current.srcObject = stream;
            }
        })

        socket.current.on("yourID", (id) => {
            setYourID(id);
        })
        socket.current.on("allUsers", (users) => {
            setUsers(users);
        })

        socket.current.on("hey", (data) => {
            setReceivingCall(true);
            setCaller(data.from);
            setCallerSignal(data.signal);
        })

        socket.current.on("callEnded", endCall);

        return () => {
            if (peerRef.current) {
                peerRef.current.destroy();
            }
            socket.current.off("callEnded", endCall);
        };
    }, []);

    const endCall = () => {
        if (peerRef.current) {
            peerRef.current.destroy();
            peerRef.current = null;
        }
        setCallAccepted(false);
        setReceivingCall(false);
        setCaller("");
        setCallerSignal(null);
    };

    function callPeer(id) {
        const peer = new Peer({
            initiator: true,
            trickle: false,
            config: {
                iceServers: [
                    { urls: "stun:stun.l.google.com:19302" },
                    // Add TURN server here if you have one
                ]
            },
            stream: stream,
        });

        peer.on("signal", data => {
            socket.current.emit("callUser", { userToCall: id, signalData: data, from: yourID })
        })

        peer.on("stream", stream => {
            if (partnerVideo.current) {
                partnerVideo.current.srcObject = stream;
            }
        });

        socket.current.on("callAccepted", signal => {
            setCallAccepted(true);
            peer.signal(signal);
        })

        peerRef.current = peer; // Set the peerRef to the current peer
    }

    function acceptCall() {
        setCallAccepted(true);
        const peer = new Peer({
            initiator: false,
            trickle: false,
            config: {
                iceServers: [
                    { urls: "stun:stun.l.google.com:19302" },
                ]
            },
            stream: stream,
        });

        peer.on("signal", data => {
            if (!peer.destroyed) {
                socket.current.emit("acceptCall", { signal: data, to: caller });
            }
        });

        peer.on("stream", stream => {
            partnerVideo.current.srcObject = stream;
        });

        if (!peer.destroyed) {
            peer.signal(callerSignal);
        }
        peerRef.current = peer;
    }


    let UserVideo;
    if (stream) {
        UserVideo = (
            <Video playsInline muted ref={userVideo} autoPlay />
        );
    }

    let PartnerVideo;
    if (callAccepted) {
        PartnerVideo = (
            <Video playsInline ref={partnerVideo} autoPlay />
        );
    }

    let incomingCall;
    if (receivingCall) {
        incomingCall = (
            <div>
                <h1>{caller} is calling you</h1>
                <button onClick={acceptCall}>Accept</button>
            </div>
        )
    }
    return (
        <Container>
            <Row>
                {UserVideo}
                {PartnerVideo}
            </Row>
            <Row>
                {Object.keys(users).map(key => {
                    if (key === yourID) {
                        return null;
                    }
                    return (
                        <button onClick={() => callPeer(key)}>Call {key}</button>
                    );
                })}
            </Row>
            <Row>
                {incomingCall}
            </Row>
        </Container>
    );
}

export default App;