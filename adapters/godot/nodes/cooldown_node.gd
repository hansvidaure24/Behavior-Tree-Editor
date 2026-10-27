class_name CooldownNode
extends BTNode

var _ready_at: float = 0.0

func _on_tick(bb: Blackboard) -> Status:
	if children.is_empty():
		return Status.FAILURE
	var now: float = Time.get_ticks_msec() / 1000.0
	if now < _ready_at:
		return Status.FAILURE
	var status = children[0].tick(bb)
	if status != Status.RUNNING:
		var duration: float = float(parameters.get("duration", 2))
		_ready_at = now + duration
	return status
