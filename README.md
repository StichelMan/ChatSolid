## React Solid Chat App

### Description

The inspiration to initiate this project was born during my undergraduate studies, where I was tasked with investigating
a cutting-edge and relatively unexplored topic in web technology. This assignment was set forth by Odisee, a renowned
educational institution located in Ghent, Belgium. This repository hosts a React-based chat application that leverages
decentralized data management using Solid principles
and Solid Project authentication. This app serves as a demonstration and open-source tool, encouraging the adoption and
implementation of Solid Project methodologies and Solid POD storage. Our vision is to shape the future of the web into a
more user-centric platform. This application is built with React and utilizes @inrupt/solid packages for essential
authentication logic.

### Table of Contents

1. Installation
2. Development Guidelines
3. Using Solid JavaScript Client
4. Issues and Community Help

### Installation

To incorporate this chat application into your project, execute:

```bash
npm install -S @inrupt/solid-ui-react
```

#### Usage

Import components such as:

```js
import {SessionProvider, LoginButton} from "@inrupt/solid-ui-react";
```

### Development Guidelines

All development adheres to Inrupt Coding Guidelines. Our linting and testing tools largely automate this compliance.

#### Getting Started

1. Clone the Repository
2. Install Dependencies
3. Start websocket server for WebRTC communication
4. Start the application

### Using Solid JavaScript Client

The @inrupt/solid-client is a JavaScript library for data access and permission management in Solid Pods. It abstracts
Solid and RDF principles and complies with the RDF/JS specification. solid-client is usable in Node.js with CommonJS
modules or in browsers with bundlers like Webpack, Rollup, or Parcel.

This client is part of Inrupt's open-source JavaScript library suite for Solid app development.

### Issues and Community Help

#### Solid Community Forum

For questions about Solid or sharing your work, visit the Solid forum. It's a great place to engage with the community.

#### Bugs and Feature Requests

Public Feedback: File an issue via GitHub.
Private Feedback or Support: Contact us through the Inrupt Service Desk.

### Feedback

For feedback, please raise issues in the issue section of the repository. All feedback is welcome!

### License

The code is available under the MIT license.