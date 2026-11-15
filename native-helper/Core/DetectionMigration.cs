internal static class DetectionMigration
{
    // Read once at helper creation; changing route requires restarting measurement/helper.
    internal static bool Enabled(string? mode) =>
        mode switch
        {
            null or "" or "independent" => true,
            "legacy" => false,
            _ => throw new ArgumentException("Unknown COACH_DETECTION_MODE"),
        };
}
