export const YinglongPassportRegistryAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "_supervisor",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_domainSalt",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "BIND_WALLET_TYPEHASH",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "STATUS_ACTIVE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "STATUS_HALTED",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "STATUS_NONE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "STATUS_REVOKED",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "acceptSupervisor",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "agentIdOf",
    "inputs": [
      {
        "name": "wallet",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "agentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "attest",
    "inputs": [
      {
        "name": "_agentId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_claimHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_expiresAt",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "attestationOf",
    "inputs": [
      {
        "name": "_agentId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_issuer",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct YinglongPassportRegistry.Attestation",
        "components": [
          {
            "name": "claimHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "issuedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "expiresAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "revoked",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "bindWalletDigest",
    "inputs": [
      {
        "name": "_agentId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_controller",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_wallet",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_deadline",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "domainSalt",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "domainSeparator",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "erc8004IdOfWallet",
    "inputs": [
      {
        "name": "_wallet",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isAttestedBy",
    "inputs": [
      {
        "name": "_agentId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_issuer",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isTrustedAgentWallet",
    "inputs": [
      {
        "name": "_wallet",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_trustedIssuers",
        "type": "address[]",
        "internalType": "address[]"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "issuersOf",
    "inputs": [
      {
        "name": "_agentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address[]",
        "internalType": "address[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "nextAgentId",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "passportOf",
    "inputs": [
      {
        "name": "_agentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct YinglongPassportRegistry.Passport",
        "components": [
          {
            "name": "controller",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "agentWallet",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "ownerDidHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "passportVcHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "provenanceHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "enforcerTableHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "jwksHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "erc8004AgentId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "identityCode",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "kid",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "registrationURI",
            "type": "string",
            "internalType": "string"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingSupervisor",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "register",
    "inputs": [
      {
        "name": "_p",
        "type": "tuple",
        "internalType": "struct YinglongPassportRegistry.RegisterParams",
        "components": [
          {
            "name": "agentWallet",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "ownerDidHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "passportVcHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "provenanceHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "enforcerTableHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "jwksHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "erc8004AgentId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "identityCode",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "kid",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "registrationURI",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "deadline",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "walletSig",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "agentId_",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "revoke",
    "inputs": [
      {
        "name": "_agentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "revokeAttestation",
    "inputs": [
      {
        "name": "_agentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setAgentWallet",
    "inputs": [
      {
        "name": "_agentId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_newWallet",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_deadline",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_walletSig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setErc8004AgentId",
    "inputs": [
      {
        "name": "_agentId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_erc8004AgentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "supervisor",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "supervisorSetStatus",
    "inputs": [
      {
        "name": "_agentId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_halted",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "transferSupervisor",
    "inputs": [
      {
        "name": "_to",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "updateHashes",
    "inputs": [
      {
        "name": "_agentId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_passportVcHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_provenanceHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_enforcerTableHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_jwksHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_kid",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "walletInfo",
    "inputs": [
      {
        "name": "_wallet",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "agentId_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "status_",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "ownerDidHash_",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "AgentWalletChanged",
    "inputs": [
      {
        "name": "agentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "oldWallet",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newWallet",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "AttestationRevoked",
    "inputs": [
      {
        "name": "agentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "issuer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Attested",
    "inputs": [
      {
        "name": "agentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "issuer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "claimHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "expiresAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PassportRegistered",
    "inputs": [
      {
        "name": "agentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "controller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "agentWallet",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "ownerDidHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PassportUpdated",
    "inputs": [
      {
        "name": "agentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "passportVcHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "provenanceHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "enforcerTableHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "jwksHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "StatusChanged",
    "inputs": [
      {
        "name": "agentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "status",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "by",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SupervisorTransferStarted",
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SupervisorTransferred",
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "InvalidSignature",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PassportRevoked",
    "inputs": [
      {
        "name": "agentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "SignatureExpired",
    "inputs": [
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Unauthorized",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnknownAgent",
    "inputs": [
      {
        "name": "agentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "WalletAlreadyBound",
    "inputs": [
      {
        "name": "wallet",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "agentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  }
] as const;
