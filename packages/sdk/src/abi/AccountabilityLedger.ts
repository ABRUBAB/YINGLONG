export const AccountabilityLedgerAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "_admin",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "admin",
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
    "name": "anchorBatch",
    "inputs": [
      {
        "name": "_root",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_count",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "_uri",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [
      {
        "name": "batchId_",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "batchCount",
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
    "name": "batchIdOfRoot",
    "inputs": [
      {
        "name": "root",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "batchIdPlusOne",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "batchOf",
    "inputs": [
      {
        "name": "_batchId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct AccountabilityLedger.Batch",
        "components": [
          {
            "name": "root",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "prevRoot",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "count",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "anchoredAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "blockNumber",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "crossAnchor",
    "inputs": [
      {
        "name": "_remoteChainId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_remoteBlockNumber",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_remoteBlockHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_remoteRoot",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_remoteBatchId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "crossId_",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "crossAnchorCount",
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
    "name": "crossAnchorOf",
    "inputs": [
      {
        "name": "_crossId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct AccountabilityLedger.CrossAnchor",
        "components": [
          {
            "name": "remoteChainId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "remoteBlockNumber",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "remoteBlockHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "remoteRoot",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "remoteBatchId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "recordedAt",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isAnchorer",
    "inputs": [
      {
        "name": "",
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
    "name": "latestRoot",
    "inputs": [],
    "outputs": [
      {
        "name": "root_",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "batchId_",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "logReceipt",
    "inputs": [
      {
        "name": "_receiptHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_agent",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_mandateHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_outcome",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setAnchorer",
    "inputs": [
      {
        "name": "_anchorer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_enabled",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "transferAdmin",
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
    "name": "verifyReceipt",
    "inputs": [
      {
        "name": "_batchId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_leaf",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_proof",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
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
    "type": "event",
    "name": "AdminTransferred",
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
    "name": "AnchorerSet",
    "inputs": [
      {
        "name": "anchorer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "enabled",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CrossAnchored",
    "inputs": [
      {
        "name": "crossId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "remoteChainId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "remoteBlockNumber",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "remoteBlockHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "remoteRoot",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "remoteBatchId",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ReceiptBatchAnchored",
    "inputs": [
      {
        "name": "batchId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "root",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "prevRoot",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "count",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "uri",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ReceiptLogged",
    "inputs": [
      {
        "name": "receiptHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "agent",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "mandateHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "outcome",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "DuplicateRoot",
    "inputs": [
      {
        "name": "root",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "EmptyBatch",
    "inputs": []
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
  }
] as const;
