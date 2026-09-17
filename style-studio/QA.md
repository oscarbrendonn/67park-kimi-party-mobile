# Style Studio preview 1

Isolated selection-screen prototype. No live game entry, map, online protocol,
character source file, or existing wardrobe was changed.

- Existing Friends assets: 3 footwear choices, rainbow wings, a backpack,
  rainbow outfit, propeller cap, crown, green glasses; each slot has a no-item option.
- Gorilla head, body rig and original hands are retained. The donor outfit's
  separate hand triangles are excluded from a cloned geometry. A second outfit
  with non-detached wrist topology was deliberately excluded.
- Headwear/glasses are extracted from existing meshes and attached to the
  gorilla Head bone, with studio-only fit offsets.
- Saves to `67park.style-studio.v1` in this browser; NOT game equipment or NFT ownership.
- Cached equipment is toggled, not allocated on each click. Source assets are unchanged.

QA: Chrome desktop 1440x960, narrow layouts 390x844 and 320x568; all selection
options, 1000 shoe swaps, save/reload, reset, original hands visibility,
walk animation and advancing render frames. No page errors. Visual front/back
inspection performed. Physical iPhone/Safari not certified.

Reference test: `/tmp/67park-party-audio-llRIah/fit-lab/check-studio.cjs`.
Mobile wardrobe scrolls independently so the character remains visible.
Publishing this directory does not activate it as the game's entry screen.
