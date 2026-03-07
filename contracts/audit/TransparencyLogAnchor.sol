// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract TransparencyLogAnchor {
    struct AnchorRecord {
        bool anchored;
        bytes32 headEntryHash;
        uint256 entryCount;
        uint256 anchoredAtBlock;
        uint256 anchoredAtTimestamp;
        address anchorer;
    }

    mapping(bytes32 => AnchorRecord) private anchors;

    event TransparencyLogRootAnchored(
        bytes32 indexed logRoot,
        bytes32 indexed headEntryHash,
        uint256 indexed entryCount,
        uint256 anchoredAtBlock,
        uint256 anchoredAtTimestamp,
        address anchorer
    );

    function anchorLogRoot(
        bytes32 logRoot,
        bytes32 headEntryHash,
        uint256 entryCount
    ) external {
        require(logRoot != bytes32(0), "empty log root");
        require(headEntryHash != bytes32(0), "empty head hash");
        require(entryCount > 0, "empty log");
        require(!anchors[logRoot].anchored, "root already anchored");

        anchors[logRoot] = AnchorRecord({
            anchored: true,
            headEntryHash: headEntryHash,
            entryCount: entryCount,
            anchoredAtBlock: block.number,
            anchoredAtTimestamp: block.timestamp,
            anchorer: msg.sender
        });

        emit TransparencyLogRootAnchored(
            logRoot,
            headEntryHash,
            entryCount,
            block.number,
            block.timestamp,
            msg.sender
        );
    }

    function getAnchor(bytes32 logRoot)
        external
        view
        returns (
            bool anchored,
            bytes32 headEntryHash,
            uint256 entryCount,
            uint256 anchoredAtBlock,
            uint256 anchoredAtTimestamp,
            address anchorer
        )
    {
        AnchorRecord memory a = anchors[logRoot];
        return (
            a.anchored,
            a.headEntryHash,
            a.entryCount,
            a.anchoredAtBlock,
            a.anchoredAtTimestamp,
            a.anchorer
        );
    }
}
