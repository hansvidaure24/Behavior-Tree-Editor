class_name SequenceNode
extends BTNode

func _on_tick(bb: Blackboard) -> Status:
	for child in children:
		var status = child.tick(bb)
		if status != Status.SUCCESS:
			return status
	return Status.SUCCESS
