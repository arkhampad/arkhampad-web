// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// ArkhamPad Pioneer: 10,000 free badges for the first people on Elysium. One per wallet, gas only.
/// The art is drawn by this contract (no server, nothing to go offline): every badge is unique, its
/// colours, orbits, star and sky come from its number. No owner, no admin, nothing can be changed.
contract ArkhamPioneer is ERC721 {
    using Strings for uint256;

    uint256 public constant MAX_SUPPLY = 10_000;
    uint256 public totalSupply;
    /// the badge a wallet minted (0 = none yet)
    mapping(address => uint256) public idOf;

    error SoldOut();
    error AlreadyMinted();
    error NotMinted();

    constructor() ERC721("ArkhamPad Pioneer", "PIONEER") {}

    function mint() external returns (uint256 id) {
        if (totalSupply >= MAX_SUPPLY) revert SoldOut();
        if (idOf[msg.sender] != 0) revert AlreadyMinted();
        id = ++totalSupply;
        idOf[msg.sender] = id;
        _mint(msg.sender, id);
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        if (_ownerOf(id) == address(0)) revert NotMinted();
        return meta(id);
    }

    function contractURI() external pure returns (string memory) {
        return string.concat(
            "data:application/json;base64,",
            Base64.encode(bytes(string.concat(
                '{"name":"ArkhamPad Pioneer","description":"10,000 free badges for the first people on Elysium. Minted only on arkhampad.com, one per wallet. Fully on-chain.","image":"data:image/svg+xml;base64,',
                Base64.encode(bytes(art(1))),
                '","external_link":"https://arkhampad.com/pioneer/"}'
            )))
        );
    }

    // ------------------------------------------------------------------ art

    struct Look {
        string tier;
        string accent;
        string accent2;
        string bg;
        string sky;
        string skyName;
        string colorName;
        uint256 rings;
        bool eight;
    }

    function look(uint256 id) public pure returns (Look memory l) {
        uint256 h = uint256(keccak256(abi.encodePacked("arkhampad-pioneer", id)));
        uint256 sky = h % 4;
        l.sky = ["#05080b", "#070614", "#03090f", "#0a0710"][sky];
        l.skyName = ["Abyss", "Midnight", "Deep Sea", "Ember Night"][sky];
        l.bg = ["#0b141a", "#100d24", "#06161f", "#170d16"][sky];
        l.rings = 2 + ((h >> 8) % 3);
        l.eight = ((h >> 16) % 3) == 0;
        if (id <= 100) {
            l.tier = "Founder";
            l.accent = "#f6c768";
            l.accent2 = "#fff1c9";
            l.colorName = "Gold";
        } else if ((h >> 24) % 40 == 0) {
            l.tier = id <= 1000 ? "Vanguard" : "Pioneer";
            l.accent = "#ff6fd8";
            l.accent2 = "#7af3ff";
            l.colorName = "Aurora";
        } else if (id <= 1000) {
            l.tier = "Vanguard";
            l.accent = "#a48bff";
            l.accent2 = "#e6deff";
            l.colorName = "Violet";
        } else {
            uint256 c = (h >> 32) % 3;
            l.tier = "Pioneer";
            l.accent = ["#3fe3d4", "#5ab8ff", "#7cf0a0"][c];
            l.accent2 = ["#d9fffb", "#e0f1ff", "#e3ffe9"][c];
            l.colorName = ["Teal", "Ice", "Mint"][c];
        }
    }

    function meta(uint256 id) public pure returns (string memory) {
        Look memory l = look(id);
        string memory attrs = string.concat(
            '[{"trait_type":"Tier","value":"', l.tier,
            '"},{"trait_type":"Color","value":"', l.colorName,
            '"},{"trait_type":"Sky","value":"', l.skyName,
            '"},{"trait_type":"Orbits","value":', l.rings.toString(),
            '},{"trait_type":"Star","value":"', l.eight ? "Eight-point" : "Four-point", '"}]'
        );
        return string.concat(
            "data:application/json;base64,",
            Base64.encode(bytes(string.concat(
                '{"name":"ArkhamPad Pioneer #', pad(id),
                '","description":"One of 10,000 badges for the first people on Elysium. Minted on arkhampad.com.","external_url":"https://arkhampad.com/pioneer/","image":"data:image/svg+xml;base64,',
                Base64.encode(bytes(art(id))),
                '","attributes":', attrs, "}"
            )))
        );
    }

    function pad(uint256 id) internal pure returns (string memory) {
        string memory s = id.toString();
        if (id < 10) return string.concat("000", s);
        if (id < 100) return string.concat("00", s);
        if (id < 1000) return string.concat("0", s);
        return s;
    }

    function art(uint256 id) public pure returns (string memory) {
        Look memory l = look(id);
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" font-family="Helvetica,Arial,sans-serif">',
            defs(l),
            '<rect width="1000" height="1000" fill="', l.sky, '"/>',
            '<rect width="1000" height="1000" fill="url(#glow)"/>',
            '<rect width="1000" height="1000" fill="url(#grid)" opacity=".5"/>',
            dust(id, l),
            orbits(id, l),
            star(l),
            label(id, l),
            "</svg>"
        );
    }

    function defs(Look memory l) internal pure returns (string memory) {
        return string.concat(
            '<defs><radialGradient id="glow" cx="50%" cy="40%" r="62%"><stop offset="0" stop-color="', l.accent,
            '" stop-opacity=".34"/><stop offset=".55" stop-color="', l.bg,
            '" stop-opacity=".6"/><stop offset="1" stop-color="', l.sky,
            '" stop-opacity="0"/></radialGradient><linearGradient id="st" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="', l.accent,
            '"/></linearGradient><linearGradient id="tx" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="', l.accent2,
            '"/></linearGradient><filter id="bl" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="22"/></filter>',
            '<pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" stroke="#fff" stroke-opacity=".05"/></pattern></defs>'
        );
    }

    function dust(uint256 id, Look memory l) internal pure returns (string memory out) {
        for (uint256 i; i < 14; i++) {
            uint256 h = uint256(keccak256(abi.encodePacked(id, "dust", i)));
            uint256 x = 40 + (h % 920);
            uint256 y = 40 + ((h >> 16) % 640);
            uint256 r = 1 + ((h >> 32) % 3);
            out = string.concat(out, '<circle cx="', x.toString(), '" cy="', y.toString(), '" r="', r.toString(),
                '" fill="', i % 4 == 0 ? l.accent2 : "#ffffff", '" opacity=".', (35 + ((h >> 40) % 55)).toString(), '"/>');
        }
    }

    function orbits(uint256 id, Look memory l) internal pure returns (string memory out) {
        out = '<g transform="translate(500 400)">';
        for (uint256 i; i < l.rings; i++) {
            uint256 r = 300 - i * 62;
            uint256 h = uint256(keccak256(abi.encodePacked(id, "orbit", i)));
            uint256 a = h % 360;
            out = string.concat(out,
                '<circle r="', r.toString(), '" fill="none" stroke="', l.accent,
                '" stroke-opacity=".', (55 - i * 12).toString(), '" stroke-width="2"', i == 1 ? ' stroke-dasharray="4 10"' : "", "/>",
                '<g transform="rotate(', a.toString(), ')"><circle cx="', r.toString(), '" r="', (i == 0 ? "9" : "6"),
                '" fill="', l.accent2, '"/><circle cx="', r.toString(), '" r="22" fill="', l.accent, '" opacity=".22" filter="url(#bl)"/></g>'
            );
        }
        out = string.concat(out, "</g>");
    }

    function star(Look memory l) internal pure returns (string memory) {
        string memory d = l.eight
            ? "M0-150L20-48L70-70L48-20L150 0L48 20L70 70L20 48L0 150L-20 48L-70 70L-48 20L-150 0L-48-20L-70-70L-20-48Z"
            : "M0-160L30-30L160 0L30 30L0 160L-30 30L-160 0L-30-30Z";
        return string.concat(
            '<g transform="translate(500 400)"><path d="', d, '" fill="', l.accent, '" opacity=".75" filter="url(#bl)"/>',
            '<path d="', d, '" fill="url(#st)"/><circle r="10" fill="#fff"/></g>'
        );
    }

    function label(uint256 id, Look memory l) internal pure returns (string memory) {
        return string.concat(
            '<rect x="40" y="40" width="920" height="920" rx="44" fill="none" stroke="', l.accent, '" stroke-opacity=".35" stroke-width="3"/>',
            '<text x="80" y="110" fill="#fff" font-size="30" font-weight="700" letter-spacing="2">ARKHAMPAD</text>',
            '<text x="920" y="110" fill="', l.accent, '" font-size="26" font-weight="700" text-anchor="end" letter-spacing="4">', upper(l.tier), "</text>",
            '<text x="80" y="800" fill="#9fb3b8" font-size="30" font-weight="700" letter-spacing="10">PIONEER</text>',
            '<text x="74" y="900" fill="url(#tx)" font-size="120" font-weight="800">#', pad(id), "</text>",
            '<text x="920" y="900" fill="#9fb3b8" font-size="26" font-weight="700" text-anchor="end" letter-spacing="3">ELYSIUM</text>'
        );
    }

    function upper(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        for (uint256 i; i < b.length; i++) if (b[i] >= 0x61 && b[i] <= 0x7a) b[i] = bytes1(uint8(b[i]) - 32);
        return string(b);
    }
}
