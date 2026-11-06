-- Usage: probe | inspect [window] | locate|press selector text [window] [match]

on attributeText(elementRef, attributeName)
    tell application "System Events"
        try
            set attributeValue to value of attribute attributeName of elementRef
            if attributeValue is missing value then return ""
            if class of attributeValue is list then return my joinText(attributeValue, ",")
            return attributeValue as text
        on error
            return ""
        end try
    end tell
end attributeText

on joinText(itemsList, separatorText)
    set savedDelimiters to AppleScript's text item delimiters
    set AppleScript's text item delimiters to separatorText
    set joinedText to itemsList as text
    set AppleScript's text item delimiters to savedDelimiters
    return joinedText
end joinText

on describeElement(elementRef)
    return "role=" & my attributeText(elementRef, "AXRole") & ¬
        " | description=" & my attributeText(elementRef, "AXDescription") & ¬
        " | help=" & my attributeText(elementRef, "AXHelp") & ¬
        " | identifier=" & my attributeText(elementRef, "AXIdentifier") & ¬
        " | enabled=" & my attributeText(elementRef, "AXEnabled") & ¬
        " | position=" & my attributeText(elementRef, "AXPosition") & ¬
        " | size=" & my attributeText(elementRef, "AXSize")
end describeElement

on positiveIndex(rawValue)
    try
        set indexValue to rawValue as integer
        if indexValue < 1 then error "Invalid index"
    on error
        error "Window and match indices must be positive integers."
    end try
    return indexValue
end positiveIndex

on run argv
    if (count argv) < 1 then error "Usage: probe | inspect [window] | locate|press help|description|identifier text [window] [match]"
    set operationName to item 1 of argv
    if operationName is not in {"probe", "inspect", "locate", "press"} then error "Unknown operation: " & operationName
    set windowIndex to 1
    set matchIndex to 0
    if operationName is "probe" and (count argv) is not 1 then error "Usage: probe"
    if operationName is "inspect" then
        if (count argv) > 2 then error "Usage: inspect [window]"
        if (count argv) is 2 then set windowIndex to my positiveIndex(item 2 of argv)
    end if
    if operationName is in {"locate", "press"} then
        if (count argv) < 3 or (count argv) > 5 then error "Usage: locate|press help|description|identifier text [window] [match]"
        set selectorName to item 2 of argv
        if selectorName is not in {"help", "description", "identifier"} then error "Unknown selector: " & selectorName
        set targetText to item 3 of argv
        if targetText is "" then error "Empty selectors are not allowed."
        if (count argv) > 3 then set windowIndex to my positiveIndex(item 4 of argv)
        if (count argv) > 4 then set matchIndex to my positiveIndex(item 5 of argv)
        if selectorName is "help" then set selectorAttribute to "AXHelp"
        if selectorName is "description" then set selectorAttribute to "AXDescription"
        if selectorName is "identifier" then set selectorAttribute to "AXIdentifier"
    end if
    tell application "System Events"
        if not (exists process "DeviceHub") then error "DeviceHub is not running. Open Device Hub from the selected Xcode."
        tell process "DeviceHub"
            set windowCount to count windows
            if windowCount is 0 then error "Device Hub has no windows. Open the target device first."
            if operationName is "probe" then
                set windowLines to {}
                repeat with i from 1 to windowCount
                    set end of windowLines to (i as text) & " | " & (name of window i as text)
                end repeat
                return my joinText(windowLines, linefeed)
            end if
            if windowIndex > windowCount then error "Window index is out of range. Run probe first."
            set targetWindow to window windowIndex
            set elementList to get entire contents of targetWindow
        end tell
    end tell
    set outputLines to {}
    set matchedElements to {}
    repeat with entryRef in elementList
        set elementRef to contents of entryRef
        set elementRole to my attributeText(elementRef, "AXRole")
        if elementRole is in {"AXButton", "AXMenuButton", "AXCheckBox", "AXRadioButton", "AXSlider", "AXGenericElement"} then
            if operationName is "inspect" then
                set end of outputLines to my describeElement(elementRef)
            else if my attributeText(elementRef, selectorAttribute) is targetText then
                set end of matchedElements to elementRef
                set end of outputLines to "match=" & ((count matchedElements) as text) & " | " & my describeElement(elementRef)
            end if
        end if
    end repeat
    if operationName is "inspect" then return my joinText(outputLines, linefeed)
    set matchCount to count matchedElements
    if matchCount is 0 then error "No matching control. Run inspect for this window."
    if operationName is "locate" then return my joinText(outputLines, linefeed)
    if matchIndex is 0 then
        if matchCount is not 1 then error "Ambiguous selector; inspect candidates and supply a match index:" & linefeed & my joinText(outputLines, linefeed)
        set matchIndex to 1
    end if
    if matchIndex > matchCount then error "Match index is out of range. Run locate first."
    set chosenElement to item matchIndex of matchedElements
    if my attributeText(chosenElement, "AXEnabled") is "false" then error "The matched control is disabled."
    tell application "System Events"
        tell process "DeviceHub" to set frontmost to true
        perform action "AXPress" of chosenElement
    end tell
    return "Pressed: " & selectorName & "=" & targetText & " | window=" & windowIndex & " | match=" & matchIndex
end run
