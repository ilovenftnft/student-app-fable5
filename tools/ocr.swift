import Foundation
import Vision
import CoreGraphics

let args = CommandLine.arguments
let path = args[1]
let from = Int(args[2])!, to = Int(args[3])!

guard let doc = CGPDFDocument(URL(fileURLWithPath: path) as CFURL) else {
    print("cannot open"); exit(1)
}
let scale: CGFloat = 3.0

for pageNo in from...min(to, doc.numberOfPages) {
    guard let page = doc.page(at: pageNo) else { continue }
    let box = page.getBoxRect(.mediaBox)
    let w = Int(box.width * scale), h = Int(box.height * scale)
    let cs = CGColorSpaceCreateDeviceGray()
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8,
                              bytesPerRow: 0, space: cs,
                              bitmapInfo: CGImageAlphaInfo.none.rawValue) else { continue }
    ctx.setFillColor(gray: 1, alpha: 1)
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.scaleBy(x: scale, y: scale)
    ctx.translateBy(x: -box.origin.x, y: -box.origin.y)
    ctx.drawPDFPage(page)
    guard let img = ctx.makeImage() else { continue }

    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.recognitionLanguages = ["zh-Hans", "en-US"]
    req.usesLanguageCorrection = true
    let handler = VNImageRequestHandler(cgImage: img, options: [:])
    try? handler.perform([req])
    var lines: [String] = []
    for obs in (req.results ?? []) {
        if let c = obs.topCandidates(1).first { lines.append(c.string) }
    }
    print("===== PDFPAGE \(pageNo) =====")
    print(lines.joined(separator: "\n"))
}
