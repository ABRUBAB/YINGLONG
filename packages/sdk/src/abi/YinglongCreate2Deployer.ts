export const YinglongCreate2DeployerAbi = [
  {
    "type": "function",
    "name": "computeAddress",
    "inputs": [
      {
        "name": "_salt",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_initCodeHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
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
    "name": "deploy",
    "inputs": [
      {
        "name": "_salt",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_initCode",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "addr_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "Deployed",
    "inputs": [
      {
        "name": "addr",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "salt",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "initCodeHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "DeployFailed",
    "inputs": []
  }
] as const;
