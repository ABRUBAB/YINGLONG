export const ProductRegistryAbi = [
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
    "name": "allProducts",
    "inputs": [],
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
    "name": "delist",
    "inputs": [
      {
        "name": "_product",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "list",
    "inputs": [
      {
        "name": "_product",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_riskClass",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "_nameHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "productInfo",
    "inputs": [
      {
        "name": "_product",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "listed_",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "riskClass_",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "products",
    "inputs": [
      {
        "name": "product",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "listed",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "riskClass",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "nameHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "ProductDelisted",
    "inputs": [
      {
        "name": "product",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ProductListed",
    "inputs": [
      {
        "name": "product",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "riskClass",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "nameHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "InvalidRiskClass",
    "inputs": [
      {
        "name": "riskClass",
        "type": "uint8",
        "internalType": "uint8"
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
  }
] as const;
