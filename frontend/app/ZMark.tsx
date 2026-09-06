// ZODD's own emblem: a chromed hexagonal plate with an engraved "Z",
// inspired by the monochrome metallic look Brai sent over, but WITHOUT
// reusing the sphinx artwork (that belongs to ZODL, a separate product).
export default function ZMark({ size = 26 }: { size?: number }) {
  return (
    <svg className="z-mark" width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M24 2 L44 13 V35 L24 46 L4 35 V13 Z"
        fill="#0e0e10"
        stroke="#e8e8ec"
        strokeWidth="1.6"
      />
      <path
        d="M24 2 L44 13 V35 L24 46 L4 35 V13 Z"
        fill="none"
        stroke="#3a3a40"
        strokeWidth="0.6"
        transform="scale(0.86)"
        transform-origin="24 24"
      />
      <text
        x="24"
        y="31"
        textAnchor="middle"
        fontFamily="ui-monospace, monospace"
        fontWeight="700"
        fontSize="20"
        fill="#e8e8ec"
      >
        Z
      </text>
    </svg>
  );
}
