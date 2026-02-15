import type { Metadata } from "next";
import Script from "next/script";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Bitget 자동매매 대시보드",
  description: "Bitget 거래소 기반 암호화폐 자동매매 플랫폼",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="dark" suppressHydrationWarning>
      <body
        className={`${plusJakarta.variable} ${jetbrainsMono.variable} antialiased`}
        suppressHydrationWarning
      >
        {/*
          Hydration guard — temporarily detach browser-extension artifacts
          (__endic_crx__, data-wxt-integrated) before React hydrates,
          then restore them once hydration is complete so extensions keep working.
        */}
        <Script strategy="beforeInteractive" id="hydration-ext-guard">{`
(function(){
  try {
    var detached = [], wxtEls = [];
    var obs = new MutationObserver(function(ml) {
      for (var i = 0; i < ml.length; i++) {
        var m = ml[i];
        if (m.type === 'childList') {
          for (var j = 0; j < m.addedNodes.length; j++) {
            var n = m.addedNodes[j];
            if (n.nodeType === 1 && n.id === '__endic_crx__') {
              detached.push({ e: n, p: n.parentNode, s: n.nextSibling });
              n.remove();
            }
          }
        }
        if (m.type === 'attributes') {
          if (m.attributeName === 'data-wxt-integrated') {
            wxtEls.push(m.target);
            m.target.removeAttribute('data-wxt-integrated');
          }
          if (m.attributeName === 'hidden' && m.target.getAttribute('data-wxt-integrated') !== null) {
            wxtEls.push(m.target);
            m.target.removeAttribute('data-wxt-integrated');
          }
        }
      }
    });
    obs.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['data-wxt-integrated', 'hidden']
    });
    window.addEventListener('load', function() {
      setTimeout(function() {
        obs.disconnect();
        detached.forEach(function(d) {
          try {
            if (d.p) d.s ? d.p.insertBefore(d.e, d.s) : d.p.appendChild(d.e);
          } catch(e) {}
        });
        wxtEls.forEach(function(el) {
          try { el.setAttribute('data-wxt-integrated', ''); } catch(e) {}
        });
      }, 3000);
    });
  } catch(e) {}
})();
        `}</Script>
        {children}
      </body>
    </html>
  );
}
