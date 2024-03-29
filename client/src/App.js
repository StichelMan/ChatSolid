import React, {useEffect, useState, useRef} from 'react';
import './App.css';
import io from "socket.io-client";
import Peer from "simple-peer";
import {SessionProvider, LoginButton, LogoutButton, useSession} from "@inrupt/solid-ui-react";
import {
    getSolidDataset,
    setThing,
    saveSolidDatasetAt,
    createThing,
    addStringNoLocale,
    createSolidDataset
} from "@inrupt/solid-client";
import {FOAF} from "@inrupt/vocab-common-rdf";

const AuthSection = () => {
    const {session} = useSession();
    const webId = session?.info?.webId;

    return (
        <div className='authentication-section'>
            <span>Logged in as: <span className='bold'>{webId || 'N/A'}</span></span>
            {session?.info?.isLoggedIn ? (
                <div className='logout-button'>
                    <LogoutButton

                        onLogout={() => console.log("Logged out")}
                        onError={(error) => console.error(error)}
                    >
                        Log Out
                    </LogoutButton>
                </div>
            ) : (
                <div className='login-button'>
                    <LoginButton
                        oidcIssuer="https://inrupt.net" // Replace with or expand to be user-configurable and to support other IdPs
                        redirectUrl="https://chatsolid.elivanstichelen.com/" // Replace with your own redirect URL
                    >
                        Log In
                    </LoginButton>
                </div>
            )}
        </div>
    );
};

function App() {
    const {session} = useSession();
    const [yourID, setYourID] = useState('');
    const [users, setUsers] = useState({});
    const [stream, setStream] = useState(null);
    const [receivingCall, setReceivingCall] = useState(false);
    const [caller, setCaller] = useState('');
    const [callerSignal, setCallerSignal] = useState(null);
    const [sendingRequest, setSendingRequest] = useState(false);
    const [callAccepted, setCallAccepted] = useState(false);
    const [message, setMessage] = useState('');
    const [receivedMessages, setReceivedMessages] = useState([]);
    const [userName, setUserName] = useState('');
    const [webId, setWebId] = useState('');
    const [partnerWebId, setPartnerWebId] = useState('');
    const chatHistoryRef = useRef([])
    const userVideo = useRef(null);
    const partnerVideo = useRef(null);
    const socket = useRef(null);
    const peerRef = useRef(null);
    const dataChannelRef = useRef(null);
    const identityChannelRef = useRef(null);

    // Fetch chat history when the partner's WebID changes
    useEffect(() => {
        if (partnerWebId && webId) {
            fetchChatHistory(partnerWebId)
                .then((history) => {
                    //alert("hannle")
                    setReceivedMessages(history);
                    chatHistoryRef.current = history

                    // Send the chat history to User B (partner) over the data channel
                    if (dataChannelRef.current) {
                        dataChannelRef.current.send(JSON.stringify({chatHistory: history}));
                    }
                });
        }
    }, [partnerWebId]);


    // Function to set up the socket.io connection
    useEffect(() => {
        setWebId(session?.info?.webId)
        setupSocketConnection();
    }, []);


    // Function to set up the socket.io connection
    useEffect(() => {
        const socketOptions = {
            transports: ["websocket"],
            // Add CORS options here
            // withCredentials: true,
            // extraHeaders: {
            //     "Access-Control-Allow-Origin": "*",
            //     "Access-Control-Allow-Methods": "GET, POST",
            //     "Access-Control-Allow-Headers": "Content-Type"
            // }
        };

        socket.current = io.connect("https://chatsolidnode.elivanstichelen.com/", socketOptions); // Replace with your own server URL
        socket.current.on("yourID", (id) => {
            setYourID(id);
        });

        socket.current.on("allUsers", (users) => {
            setUsers(users);
        });

        socket.current.on("hey", (data) => {
            setReceivingCall(true);
            setCaller(data.from);
            setCallerSignal(data.signal);
        });

        socket.current.on("callEnded", endCall);

        // Get user media and set stream
        navigator.mediaDevices.getUserMedia({video: true, audio: true}).then((stream) => {
            setStream(stream);
            if (userVideo.current) {
                userVideo.current.srcObject = stream;
            }
        });

        // Clean up socket.io connection when unmounting
        return () => {
            if (socket.current) {
                socket.current.disconnect();
            }
            if (peerRef.current) {
                peerRef.current.destroy();
            }
        };
    }, []);

    // Handling the use and change of the user's WebID
    useEffect(() => {
        setWebId(session?.info?.webId)
    }, [session?.info?.isLoggedIn, yourID]);

    // Function to set up the socket.io connection
    const setupSocketConnection = () => {
        socket.current = io.connect("https://chatsolidnode.elivanstichelen.com/"); // Replace with your own server URL
        socket.current.on("yourID", (id) => {
            setYourID(id); // Use session ID as primary identifier
            socket.current.emit('identifyUser', id);
        });

        socket.current.on("allUsers", (users) => {
            setUsers(users);
        });
    };

    // Function to set the user's name (optional, unfinished and unrelated but can be used for future features)
    const handleSetUserName = () => {
        if (!userName) return;
        socket.current.emit('setUserInfo', {id: yourID, name: userName}); // Use session ID
    };

    // Function to end a call and clean up the peer connection
    const endCall = () => {
        if (peerRef.current) {
            peerRef.current.destroy();
        }
        peerRef.current = null; // Reset the peerRef to null after destroying the peer
        setSendingRequest(false);
        setCallAccepted(false);
        setReceivingCall(false);
        setCaller("");
        setCallerSignal(null);
    };

    // Function to call a peer and then establish a peer connection and optional logic on this occurrence
    async function callPeer(id) {
        const chatHistory = chatHistoryRef.current;
        // while (chatHistory === null){
        //     await new Promise((resolve) => setTimeout(resolve, 500));
        //     console.log("ik als in de man wacht")
        // }
        if (peerRef.current) {
            peerRef.current.destroy();
            peerRef.current = null;
        }
        setSendingRequest(true);
        const peer = new Peer({
            initiator: true,
            trickle: false,
            config: {
                iceServers: [{urls: "stun:stun.l.google.com:19302"}] // Replace with your own STUN or TURN server if needed
            },
            stream: stream,
        });

        peer.on("signal", data => {
            if (peerRef.current && !peerRef.current.destroyed) {
                socket.current.emit("callUser", {userToCall: id, signalData: data, from: yourID});
            }
        });

        peer.on('connect', () => {
            dataChannelRef.current = peer;
            if (session?.info?.isLoggedIn) {
                dataChannelRef.current.send(JSON.stringify({webId: session.info.webId}));
            }

            // if (partnerChatHistory.length > 0) {
            //     dataChannelRef.current.send(JSON.stringify({ webId: session.info.webId, chatHistory: partnerChatHistory }));
            // }

            // setPartnerWebId(session?.info?.webId)
            identityChannelRef.current = peer;
            identityChannelRef.current.send(webId);

            const chatHistory = chatHistoryRef.current;
            if (chatHistoryRef.current.length > 0) {
                dataChannelRef.current.send(JSON.stringify({chatHistory: chatHistory}));
            }
            dataChannelRef.current.send(JSON.stringify({chatHistory: chatHistory}));
            // identityChannelRef.current.send(receivedMessages)
            // Fetch chat history when the connection is established
            // fetchChatHistory(formatWebIdForFilename(partnerWebId)) // Replace 'partnerWebId' with the actual WebID of the partner
            //     .then(history => setReceivedMessages(history));
        });

        // Handle incoming messages
        peer.on('data', handleMessageReceive);

        peer.on("stream", stream => {
            if (partnerVideo.current) {
                partnerVideo.current.srcObject = stream;
            }
        });

        socket.current.on("callAccepted", signal => {
            try {
                setCallAccepted(true);
                peerRef.current.signal(signal);
            } catch (e) {
                console.error(e);
            }

        });

        peer.on('close', () => {
            console.log("Peer connection closed");
            endCall();
        });

        peer.on("error", err => {
            console.error("Peer Connection Error:", err);
            endCall();
        });

        peerRef.current = peer; // Set the peerRef to the current peer
    }

    // Function to accept an incoming call and then establish a peer connection and optional logic on this occurrence
    function acceptCall() {
        if (peerRef.current) {
            peerRef.current.destroy();
            peerRef.current = null;
        }

        setCallAccepted(true);
        const peer = new Peer({
            initiator: false,
            trickle: false,
            config: {
                iceServers: [{urls: "stun:stun.l.google.com:19302"}] // Replace with your own STUN or TURN server if needed
            },
            stream: stream,
        });

        peer.on("signal", data => {
            if (!peer.destroyed) {
                socket.current.emit("acceptCall", {signal: data, to: caller});
            }
        });


        peer.on('connect', () => {
            dataChannelRef.current = peer;
            if (session?.info?.isLoggedIn) {
                dataChannelRef.current.send(JSON.stringify({webId: session.info.webId}));
            }

            // if (partnerChatHistory.length > 0) {
            //     dataChannelRef.current.send(JSON.stringify({ webId: session.info.webId, chatHistory: partnerChatHistory }));
            // }

            // setPartnerWebId(session?.info?.webId)
            identityChannelRef.current = peer;
            identityChannelRef.current.send(webId);

            const chatHistory = chatHistoryRef.current;

            if (chatHistory.length > 0) {
                dataChannelRef.current.send(JSON.stringify({chatHistory: chatHistory}));
            }
            dataChannelRef.current.send(JSON.stringify({chatHistory: chatHistory}));
            // identityChannelRef.current.send(receivedMessages)
            // Fetch chat history when the connection is established
            // fetchChatHistory(formatWebIdForFilename(partnerWebId)) // Replace 'partnerWebId' with the actual WebID of the partner
            //     .then(history => setReceivedMessages(history));
        });

        // Handle incoming messages
        peer.on('data', handleMessageReceive);

        peer.on("stream", stream => {
            if (partnerVideo.current) {
                partnerVideo.current.srcObject = stream;
            }
        });

        peer.on('close', () => {
            console.log("Peer connection closed");
            endCall();
        });


        if (!peer.destroyed) {
            peer.signal(callerSignal);
        }
        peer.on("error", err => {
            console.error("Peer Connection Error:", err);
            endCall();
        });
        peerRef.current = peer;
    }

    // Function to fetch chat history from the user's Solid pod
    const fetchChatHistory = async (partnerWebId) => {
        console.log("partnerWebId:", partnerWebId); // Add this to log and check the value

        // // Validate if partnerWebId is a valid URL
        // if (!partnerWebId || !isValidHttpUrl(partnerWebId)) {
        //     console.error("Invalid partnerWebId:", partnerWebId);
        //     return []; // Return empty array if invalid
        // }

        const safePartnerWebId = formatWebIdForFilename(partnerWebId);
        const storageUrl = new URL(`/ChatSolid/chats/${safePartnerWebId}.ttl`, session.info.webId).toString();

        try {
            const dataset = await getSolidDataset(storageUrl, {fetch: session.fetch});
            console.log('Chat history found');
            return processChatHistory(dataset);
        } catch (error) {
            console.log('No chat history found', error);
            return []; // Return an empty array if no history is found
        }
    };


    // Function to process chat history from a SolidDataset to an array of messages which can be displayed in the chat UI (or used for other purposes)
    const processChatHistory = (dataset) => {
        const messages = dataset.graphs.default;
        return Object.entries(messages).map(([url, messageEntry]) => {
            const messageText = messageEntry.predicates['http://xmlns.com/foaf/0.1/message'].literals['http://www.w3.org/2001/XMLSchema#string'][0]; // Replace with the actual predicate URL and Linked Data principles that fit the purpose of the data saved/fetched
            const timestamp = new Date(url.split("#message-")[1]);
            return {timestamp, message: messageText};
        });
    };


    // Function to log chat messages to the console for debugging
    function logChatMessages(dataset) {
        const messages = dataset.graphs.default;
        Object.entries(messages).forEach(([url, messageEntry]) => {
            const messageText = messageEntry.predicates['http://xmlns.com/foaf/0.1/message'].literals['http://www.w3.org/2001/XMLSchema#string'][0]; // Replace with the actual predicate URL and Linked Data principles that fit the purpose of the data saved/fetched

            // Extracting the timestamp from the URL
            const timestamp = url.split("#message-")[1];

            console.log(`Date: ${timestamp}, Message: ${messageText}`);
        });
    }

    // Function to save a message to the user's Solid pod
    // Function to replace special URL characters with underscores
    const formatWebIdForFilename = (webId) => {
        // Remove the protocol part
        let simplified = webId.replace(/^https?:\/\//, '');

        // Replace special characters with an underscore or a dash
        simplified = simplified.replace(/[\/:]/g, '_');

        return simplified;
    };

    // Function to save a message to the user's Solid pod
    const saveMessageToPod = async (message, recipientWebId) => {
        if (!session.info.isLoggedIn || !recipientWebId) return;

        // Format the WebID to be safe for use as a filename
        const safeRecipientWebId = formatWebIdForFilename(recipientWebId);
        const storageUrl = new URL(`/ChatSolid/chats/${safeRecipientWebId}.ttl`, session.info.webId).toString();

        let dataset;
        try {
            dataset = await getSolidDataset(storageUrl, {fetch: session.fetch});
            console.log('Chat history found');
        } catch (error) {
            console.log('No chat history found, creating new dataset');
            dataset = createSolidDataset();
        }

        const newMessageThing = createThing({name: `message-${new Date().toISOString()}`}); // Replace with the actual predicate URL and Linked Data principles that fit the purpose of the data saved/fetched
        const updatedMessageThing = addStringNoLocale(newMessageThing, FOAF.name, message);
        dataset = setThing(dataset, updatedMessageThing);

        try {
            await saveSolidDatasetAt(storageUrl, dataset, {fetch: session.fetch});
        } catch (error) {
            console.error("Error saving message to Solid pod:", error);
        }
    };


    // Function to send a message over the data channel
    const sendMessage = () => {
        const newMessage = {timestamp: new Date(), message: `You: ${message}`};
        setReceivedMessages(oldMsgs => [...oldMsgs, newMessage]);
        if (dataChannelRef.current && message !== "") {
            dataChannelRef.current.send(message);
            saveMessageToPod(message, formatWebIdForFilename(partnerWebId)); // Assuming partnerWebId is the WebID of the chat partner
            setMessage("");
        }
    };

    // Function to handle received messages
    const handleMessageReceive = (data) => {
        try {
            // Attempt to parse received data as JSON
            const parsedData = JSON.parse(data);

            if (parsedData.webId) {
                setPartnerWebId(parsedData.webId);
            } else if (parsedData.chatHistory) {
                // const mergedHistory = mergeHistories(receivedMessages, parsedData.chatHistory);
                setReceivedMessages(receivedMessages => [...receivedMessages, ...parsedData.chatHistory]);
            }
        } catch (e) {
            // If parsing fails, treat it as a regular message
            const receivedMessage = data.toString();
            setReceivedMessages(oldMsgs => [...oldMsgs, {
                timestamp: new Date(),
                message: `Partner: ${receivedMessage}`
            }]);
        }
    };


    // const mergeHistories = (history1, history2) => {
    //     const combinedHistory = [...history1, ...history2];
    //     return combinedHistory.sort((a, b) => a.timestamp - b.timestamp);
    // };

    let UserVideo;
    if (stream) {
        UserVideo = (
            <video playsInline muted ref={userVideo} autoPlay/>
        );
    }
    let callStatus
    let PartnerVideo;
    if (callAccepted) {
        PartnerVideo = (
            <video playsInline ref={partnerVideo} autoPlay/>
        );
        callStatus = (
            'Connected'
        );
    } else {
        PartnerVideo = (
            ''
        );
    }


    if (stream && !callAccepted && (receivingCall || sendingRequest)) {
        callStatus = (
            'Waiting...'
        );
    }

    let incomingCall;
    if (receivingCall) {
        incomingCall = (
            <div className="callpopup-wrapper">
                <h1>{caller} is calling you</h1>
                <button className="action-button" onClick={acceptCall}>Accept</button>
            </div>
        )
        callStatus = (
            'Waiting...'
        );
    }

    // Function to handle send message on pressing 'Enter' key
    const handleKeyPress = (e) => {
        // Check if the pressed key is 'Enter'
        if (e.key === 'Enter') {
            sendMessage();
        }
    };

    // Update the user's identity on the server when the session changes
    useEffect(() => {
        const identifier = session?.info?.isLoggedIn ? session?.info?.webId : yourID;
        if (socket.current && identifier) {
            socket.current.emit('identifyUser', identifier);
        }
    }, [session?.info?.isLoggedIn, session?.info?.webId, yourID]);

    // Clean up the peer connection and socket.io connection when the user disconnects
    useEffect(() => {
        return () => {
            socket.current.emit('userDisconnect', yourID);
            if (peerRef.current) {
                peerRef.current.destroy();
            }
        };
    }, [yourID]);

    // Update the renderCallButtons function based on the calling status
    const renderCallButtons = () => {
        if (Object.keys(users).length <= 1) return (<p>No other users online</p>);
        if (receivingCall || callAccepted || sendingRequest) return (
            <>
                <p>{!callAccepted ? callStatus : 'Connected'}</p>
                <button className='action-button' onClick={() => endCall()}>
                    <span className='bold'>Disconnect</span>
                </button>
            </>
        );
        return Object.keys(users).map(key => {
            if (key === yourID) return null;
            return (
                <button key={key} className='call-button' onClick={() => callPeer(key)}>
                    <span key={partnerWebId + '-' + key} className='bold'>Call User</span><br/> {key}
                </button>
            );
        });
    };

    return (
        <SessionProvider sessionId="solid-chat-session">
            <div className="container">
                <div className="title-section">
                    <h1 className="title">ChatSolid</h1>
                    <p className="subtitle">By Eli Van Stichelen</p>
                </div>
                <div className="video-group">
                    <div className="default-col">
                        <span className='white'>{stream && session?.info?.isLoggedIn && <p>WebID: {webId}</p>}</span>
                        <div className="user-video video-wrapper">
                            {UserVideo}
                            {/*{callAccepted ? UserVideo : ''}*/}
                            <p className="user-label">Me</p>
                        </div>
                    </div>
                    <div className="default-col">
                        <span className='white'>{stream && session?.info?.isLoggedIn &&
                            <p>WebID: {partnerWebId}</p>}</span>
                        <div className={"partner-video video-wrapper" + (!callAccepted ? " disabled" : "")}>
                            {PartnerVideo}
                            <p className="user-label">Other user</p>
                            {!callAccepted && (
                                <div className="no-session">
                                    No current session
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <div className='dashboard-row'>
                    <div className="info">
                        {renderCallButtons()}
                    </div>
                    <div className={"chat-session" + (!callAccepted ? " disabled" : "")}>
                        <div className="title-section chat-title">
                            <h2>Solid Chat</h2>
                        </div>
                        <div className="chat-messages" key={partnerWebId}>
                            {receivedMessages.map((msgObj, index) => (
                                <p key={index}>{`Date: ${msgObj.timestamp.toLocaleString()}, Message: ${msgObj.message}`}</p>
                            ))}
                        </div>

                        <div className="input-actions">
                            <input
                                className="input"
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                onKeyPress={handleKeyPress}
                                type="text"
                                placeholder="Type message here..."
                            />
                            <button className='action-button' onClick={sendMessage}>Send</button>
                        </div>
                        {!callAccepted && (
                            <div className="no-session">
                                No current session
                            </div>
                        )}
                    </div>
                    <div className="info">
                        <AuthSection/>
                        <p className="bold overflow-breakword">Current User ID:<br/> {yourID}</p>
                        <div className="input-actions">
                            <input className="input" type="text" placeholder="Enter your name" value={userName}
                                   onChange={(e) => setUserName(e.target.value)}/>
                            <button className="action-button" onClick={handleSetUserName}>Set Name</button>
                        </div>
                    </div>
                </div>
                {incomingCall && !callAccepted &&
                    <div className="incoming-call">
                        <div className="callpopup-wrapper">
                            <h1>{caller} is calling you</h1>
                            <button className="action-button" onClick={acceptCall}>Accept</button>
                        </div>
                    </div>
                }
            </div>
        </SessionProvider>
    );
}

export default App;