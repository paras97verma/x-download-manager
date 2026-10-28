import SafariServices
import os.log

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let message = item?.userInfo?[SFExtensionMessageKey]
        os_log(.default, "XDM Safari WebExtension received message: %@", String(describing: message))

        // Forward intercepted download payload to XDM Local IPC Bridge (http://127.0.0.1:45678/api/v1/intercept)
        if let dict = message as? [String: Any],
           let jsonData = try? JSONSerialization.data(withJSONObject: dict),
           let url = URL(string: "http://127.0.0.1:45678/api/v1/intercept") {
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = jsonData
            URLSession.shared.dataTask(with: req).resume()
        }

        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: ["accepted": true, "app": "X Download Manager"]]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
