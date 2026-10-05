// Times the macOS call that lists Share destinations for a file, three times per file.
// This is the call an Electron app makes when it builds a Share menu.
// Usage: swift tools/share-lookup.swift /etc/hosts [more files]
import AppKit

for path in CommandLine.arguments.dropFirst() {
  for round in 1...3 {
    let start = Date()
    let services = NSSharingService.sharingServices(forItems: [URL(fileURLWithPath: path)])
    let elapsed = Date().timeIntervalSince(start) * 1000
    let name = (path as NSString).lastPathComponent
    print(String(format: "%@ round %d: %d services in %.0f ms", name, round, services.count, elapsed))
  }
}
